(() => {
  const STORAGE_KEY = 'simple-projects-v1';
  const SUPABASE_URL = window.MY_PROJECTS_SUPABASE_URL || '';
  const SUPABASE_KEY = window.MY_PROJECTS_SUPABASE_KEY || '';
  const cloudReady = !!(window.supabase && SUPABASE_URL && SUPABASE_KEY);
  // Use Supabase's default auth storage and session handling. These defaults
  // already persist sessions in localStorage; explicitly supplying storage here
  // is unnecessary and can interfere with recovery from an older cached build.
  const db = cloudReady ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
  let session = null;
  let syncTimer = null;
  let isLoadingCloud = false;
  let pendingSync = localStorage.getItem('my-projects-pending-sync') === '1';
  const LOCAL_ACCESS_KEY = 'my-projects-local-access-enabled';
  const DELETED_PROJECTS_KEY = 'my-projects-deleted-project-ids';
  const DELETED_TASKS_KEY = 'my-projects-deleted-task-ids';
  function readTombstones(key) { try { const v=JSON.parse(localStorage.getItem(key)||'[]'); return Array.isArray(v) ? [...new Set(v.filter(x=>typeof x==='string'))] : []; } catch { return []; } }
  function addTombstone(key, id) { const ids=readTombstones(key); if(!ids.includes(id)) ids.push(id); localStorage.setItem(key, JSON.stringify(ids)); }
  function clearTombstones() { localStorage.removeItem(DELETED_PROJECTS_KEY); localStorage.removeItem(DELETED_TASKS_KEY); }
  let projects = loadProjects();
  let standaloneTasks = loadStandaloneTasks();
  let currentId = null;
  let editingId = null;
  let toastTimer;

  const $ = id => document.getElementById(id);
  const views = { home: $('homeView'), project: $('projectView'), form: $('formView') };
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16); }); }
  function todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function isUuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
  function loadProjects() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string').map(p => ({
        id:isUuid(p.id) ? p.id : uid(), name:p.name, notes:typeof p.notes === 'string' ? p.notes : '',
        createdAt:p.createdAt || new Date().toISOString(),
        tasks:Array.isArray(p.tasks) ? p.tasks.filter(t => t && typeof t.text === 'string').map(t => ({
          id:isUuid(t.id) ? t.id : uid(), text:t.text, done:!!t.done,
          createdAt:t.createdAt || p.createdAt || new Date().toISOString(),
          dueDate:t.dueDate || '', completedAt:t.done ? (t.completedAt || new Date().toISOString()) : '', plannedFor:t.plannedFor || ''
        })) : []
      })) : [];
    } catch { return []; }
  }
  function loadStandaloneTasks() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY + '-standalone') || '[]');
      return Array.isArray(parsed) ? parsed.filter(t => t && typeof t.text === 'string').map(t => ({
        id:isUuid(t.id) ? t.id : uid(), text:t.text, done:!!t.done,
        createdAt:t.createdAt || new Date().toISOString(),
        dueDate:t.dueDate || '', completedAt:t.done ? (t.completedAt || new Date().toISOString()) : '', plannedFor:t.plannedFor || ''
      })) : [];
    } catch { return []; }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
      localStorage.setItem(STORAGE_KEY + '-standalone', JSON.stringify(standaloneTasks));
      pendingSync = true;
      localStorage.setItem('my-projects-pending-sync', '1');
    } catch { showToast('Could not save locally. Check available device storage.'); return; }
    if (!navigator.onLine) { setSyncStatus('Offline — changes saved on this device'); return; }
    if (session && db && !isLoadingCloud) {
      clearTimeout(syncTimer); setSyncStatus('Changes saved locally — syncing…');
      syncTimer = setTimeout(() => syncToCloud().catch(err => setSyncStatus('Sync pending: ' + (err.message || 'will retry when online'))), 500);
    } else setSyncStatus('Saved on this device');
  }
  function setSyncStatus(text) { const el = $('syncStatus'); if (el) el.textContent = text; }
  function mergeById(remote, local) {
    const map = new Map((remote || []).map(item => [item.id, item]));
    (local || []).forEach(item => map.set(item.id, item));
    return Array.from(map.values());
  }
  function cloudRows(userId) {
    const projectRows = projects.map(p => ({id:p.id, user_id:userId, name:p.name, notes:p.notes || '', created_at:p.createdAt || new Date().toISOString(), updated_at:new Date().toISOString()}));
    const taskRows = [];
    projects.forEach(p => p.tasks.forEach(t => taskRows.push({id:t.id, user_id:userId, project_id:p.id, title:t.text, notes:'', created_at:t.createdAt || new Date().toISOString(), due_date:t.dueDate || null, completed_at:t.done ? (t.completedAt || new Date().toISOString()) : null, planned_for:t.plannedFor || null, sort_order:0})));
    standaloneTasks.forEach(t => taskRows.push({id:t.id, user_id:userId, project_id:null, title:t.text, notes:'', created_at:t.createdAt || new Date().toISOString(), due_date:t.dueDate || null, completed_at:t.done ? (t.completedAt || new Date().toISOString()) : null, planned_for:t.plannedFor || null, sort_order:0}));
    return {projectRows, taskRows};
  }
  // Serialize sync attempts. The 20-second poll, focus/pageshow events and a local
  // delete can otherwise start overlapping syncs; one sync can re-upload a task
  // while another is processing its deletion tombstone.
  let syncPromise = null;
  function syncToCloud() {
    if (syncPromise) return syncPromise;
    syncPromise = syncToCloudImpl().finally(() => { syncPromise = null; });
    return syncPromise;
  }
  async function syncToCloudImpl() {
    if (!session || !db) { setSyncStatus(navigator.onLine ? 'Saved on this device' : 'Offline — changes saved on this device'); return; }
    if (!navigator.onLine) { setSyncStatus('Offline — changes saved on this device'); return; }
    setSyncStatus('Syncing…');
    const userId = session.user.id;
    // Explicit user deletions are queued locally and applied to the cloud only when online.
    // Never infer deletions from records missing in this device's local copy.
    const localDeletedTaskIds = readTombstones(DELETED_TASKS_KEY);
    const localDeletedProjectIds = readTombstones(DELETED_PROJECTS_KEY);

    // Task deletion records are shared across all app origins/devices, just like
    // project deletion records. This prevents stale standalone-task copies from
    // being merged back into Supabase by another app instance.
    const { data: sharedTaskDeletions, error: sharedTaskDeletionReadError } = await db
      .from('task_deletion_tombstones')
      .select('task_id')
      .eq('user_id', userId);
    if (sharedTaskDeletionReadError) throw new Error('Task deletion protection is not configured. Run the updated SQL in Supabase first. Details: ' + sharedTaskDeletionReadError.message);
    const sharedDeletedTaskIds = (sharedTaskDeletions || []).map(row => row.task_id);

    // Publish local task deletion records before fetching/uploading task data.
    if (localDeletedTaskIds.length) {
      const taskDeletionRows = localDeletedTaskIds.map(taskId => ({ user_id: userId, task_id: taskId }));
      const { error: publishTaskDeletionError } = await db.from('task_deletion_tombstones')
        .upsert(taskDeletionRows, { onConflict: 'user_id,task_id', ignoreDuplicates: true });
      if (publishTaskDeletionError) throw publishTaskDeletionError;
    }
    const deletedTaskIds = [...new Set([...localDeletedTaskIds, ...sharedDeletedTaskIds])];

    // Project deletion records live in Supabase so every browser origin/device
    // sees them. A stale app must not resurrect a project from its local cache.
    const { data: sharedProjectDeletions, error: sharedDeletionReadError } = await db
      .from('project_deletion_tombstones')
      .select('project_id')
      .eq('user_id', userId);
    if (sharedDeletionReadError) throw new Error('Project deletion protection is not configured. Run the supplied SQL in Supabase first. Details: ' + sharedDeletionReadError.message);
    const sharedDeletedProjectIds = (sharedProjectDeletions || []).map(row => row.project_id);
    const deletedProjectIds = [...new Set([...localDeletedProjectIds, ...sharedDeletedProjectIds])];

    // Publish local deletion records before fetching/uploading project data.
    if (localDeletedProjectIds.length) {
      const deletionRows = localDeletedProjectIds.map(projectId => ({ user_id: userId, project_id: projectId }));
      const { error: publishDeletionError } = await db.from('project_deletion_tombstones')
        .upsert(deletionRows, { onConflict: 'user_id,project_id', ignoreDuplicates: true });
      if (publishDeletionError) throw publishDeletionError;
    }

    if (deletedTaskIds.length) {
      // Verify the requested deletions actually happened. PostgREST can return no error
      // when RLS/filtering means zero rows were affected, so an error-only check is not enough.
      const {data: existingTasks, error: existingTasksError} = await db.from('tasks').select('id').eq('user_id', userId).in('id', deletedTaskIds);
      if (existingTasksError) throw existingTasksError;
      const existingTaskIds = (existingTasks || []).map(row => row.id);
      if (existingTaskIds.length) {
        const {data: deletedTasks, error: deleteTasksError} = await db.from('tasks').delete().eq('user_id', userId).in('id', existingTaskIds).select('id');
        if (deleteTasksError) throw deleteTasksError;
        const deletedTaskSet = new Set((deletedTasks || []).map(row => row.id));
        const remainingTaskIds = existingTaskIds.filter(id => !deletedTaskSet.has(id));
        if (remainingTaskIds.length) throw new Error('Could not confirm deletion of task record(s): ' + remainingTaskIds.join(', ') + '. The deletion remains queued for retry.');
      }
    }
    if (deletedProjectIds.length) {
      // Remove child tasks first, then the projects. The shared tombstones remain
      // permanently, even after this device clears its local deletion queue.
      const { error: deleteProjectTasksError } = await db.from('tasks').delete()
        .eq('user_id', userId).in('project_id', deletedProjectIds);
      if (deleteProjectTasksError) throw deleteProjectTasksError;
      const {data: existingProjects, error: existingProjectsError} = await db.from('projects').select('id').eq('user_id', userId).in('id', deletedProjectIds);
      if (existingProjectsError) throw existingProjectsError;
      const existingProjectIds = (existingProjects || []).map(row => row.id);
      if (existingProjectIds.length) {
        const {data: deletedProjects, error: deleteProjectsError} = await db.from('projects').delete().eq('user_id', userId).in('id', existingProjectIds).select('id');
        if (deleteProjectsError) throw deleteProjectsError;
        const deletedProjectSet = new Set((deletedProjects || []).map(row => row.id));
        const remainingProjectIds = existingProjectIds.filter(id => !deletedProjectSet.has(id));
        if (remainingProjectIds.length) throw new Error('Could not confirm deletion of project record(s): ' + remainingProjectIds.join(', ') + '. The deletion remains queued for retry.');
      }
    }
    // Fetch cloud state before uploading so another device's records are not overwritten by an incomplete local cache.
    const [{data:pr,error:pe},{data:tr,error:te}] = await Promise.all([
      db.from('projects').select('*').eq('user_id',userId),
      db.from('tasks').select('*').eq('user_id',userId)
    ]);
    if (pe) throw pe; if (te) throw te;
    const localWasPending = pendingSync;
    const deletedProjectSet = new Set(deletedProjectIds);
    const deletedTaskSet = new Set(deletedTaskIds);
    const remoteProjects = (pr || []).filter(row => !deletedProjectSet.has(row.id)).map(row => ({id:row.id,name:row.name,notes:row.notes || '',createdAt:row.created_at,tasks:[]}));
    const remoteTasks = (tr || []).filter(row => !deletedTaskSet.has(row.id) && !deletedProjectSet.has(row.project_id)).map(row => ({id:row.id,text:row.title,done:!!row.completed_at,createdAt:row.created_at,dueDate:row.due_date || '',completedAt:row.completed_at || '',plannedFor:row.planned_for || '' , projectId:row.project_id || ''}));
    if (!localWasPending) {
      projects = remoteProjects;
      standaloneTasks = [];
      remoteTasks.forEach(t => { if (t.projectId) { const p=projects.find(x=>x.id===t.projectId); if(p) p.tasks.push(t); } else { delete t.projectId; standaloneTasks.push(t); } });
    } else {
      // Local changes win for matching IDs; cloud-only records are retained and merged in.
      const mergedProjects = mergeById(remoteProjects, projects);
      const allLocalTasks = [...projects.flatMap(p=>p.tasks.map(t=>({...t,projectId:p.id}))), ...standaloneTasks.map(t=>({...t,projectId:''}))];
      const mergedTasks = mergeById(remoteTasks, allLocalTasks);
      projects = mergedProjects.map(p=>({...p,tasks:[]})); standaloneTasks=[];
      mergedTasks.forEach(t=>{ const pid=t.projectId || ''; delete t.projectId; if(pid){const p=projects.find(x=>x.id===pid); if(p)p.tasks.push(t);} else standaloneTasks.push(t); });
    }
    // Final guard: never upload a deleted project or task from stale local data.
    const deletedProjectSetForUpload = new Set(deletedProjectIds);
    const deletedTaskSetForUpload = new Set(deletedTaskIds);
    projects = projects.filter(project => !deletedProjectSetForUpload.has(project.id));
    projects.forEach(project => { project.tasks = project.tasks.filter(task => !deletedTaskSetForUpload.has(task.id)); });
    standaloneTasks = standaloneTasks.filter(task => !deletedTaskSetForUpload.has(task.id));
    const {projectRows,taskRows} = cloudRows(userId);
    if (projectRows.length) { const {error}=await db.from('projects').upsert(projectRows,{onConflict:'id'}); if(error) throw error; }
    if (taskRows.length) { const {error}=await db.from('tasks').upsert(taskRows,{onConflict:'id'}); if(error) throw error; }
    localStorage.setItem(STORAGE_KEY,JSON.stringify(projects)); localStorage.setItem(STORAGE_KEY+'-standalone',JSON.stringify(standaloneTasks));
    pendingSync=false; localStorage.removeItem('my-projects-pending-sync');
    clearTombstones();
    setSyncStatus('Synced just now'); renderHome(); renderStandaloneTasks();
  }
  async function loadCloudData() {
    if (!session || !db) return;
    if (!navigator.onLine) { showSignedIn(); setSyncStatus(pendingSync ? 'Offline — changes waiting to sync' : 'Offline — showing saved data'); return; }
    isLoadingCloud = true; setSyncStatus('Loading your projects…');
    try {
      const uid = session.user.id;
      const [{data:pr,error:pe},{data:tr,error:te}] = await Promise.all([
        db.from('projects').select('*').eq('user_id',uid).order('created_at',{ascending:false}),
        db.from('tasks').select('*').eq('user_id',uid).order('created_at',{ascending:true})
      ]);
      if (pe) throw pe; if (te) throw te;
      const { data: sharedTaskDeletions, error: sharedTaskDeletionError } = await db
        .from('task_deletion_tombstones').select('task_id').eq('user_id', uid);
      if (sharedTaskDeletionError) throw sharedTaskDeletionError;
      const deletedTaskIds = new Set((sharedTaskDeletions || []).map(row => row.task_id));
      const filteredTasks = (tr || []).filter(row => !deletedTaskIds.has(row.id));
      if ((!pr || !pr.length) && (!filteredTasks.length)) {
        if (projects.length || standaloneTasks.length) { pendingSync=true; localStorage.setItem('my-projects-pending-sync','1'); }
      } else if (!pendingSync) {
        projects = (pr || []).map(row => ({id:row.id,name:row.name,notes:row.notes || '',createdAt:row.created_at,tasks:[]}));
        standaloneTasks = [];
        filteredTasks.forEach(row => { const t={id:row.id,text:row.title,done:!!row.completed_at,createdAt:row.created_at,dueDate:row.due_date || '',completedAt:row.completed_at || '',plannedFor:row.planned_for || ''}; if(row.project_id){const p=projects.find(p=>p.id===row.project_id);if(p)p.tasks.push(t);}else standaloneTasks.push(t); });
        localStorage.setItem(STORAGE_KEY,JSON.stringify(projects)); localStorage.setItem(STORAGE_KEY+'-standalone',JSON.stringify(standaloneTasks));
      }
      renderHome(); renderStandaloneTasks();
      if (pendingSync) await syncToCloud(); else setSyncStatus('Synced');
    } catch(err) { setSyncStatus(navigator.onLine ? 'Sync pending — retrying when possible' : 'Offline — changes saved on this device'); }
    finally { isLoadingCloud=false; }
  }
  function showSignedIn() { $('authView').classList.add('hidden'); $('appRoot').classList.remove('hidden'); renderHome(); }
  async function handleAuth(mode) {
    if (!db) { $('authStatus').textContent = 'Connection is not configured. Add your Supabase URL and publishable key to config.js.'; return; }
    const email = $('authEmail').value.trim(), password = $('authPassword').value;
    if (!email || !password) { $('authStatus').textContent = 'Enter your email and password.'; return; }
    $('authStatus').textContent = mode === 'signup' ? 'Creating account…' : 'Signing in…';
    const result = mode === 'signup' ? await db.auth.signUp({email,password}) : await db.auth.signInWithPassword({email,password});
    if (result.error) { $('authStatus').textContent = result.error.message; return; }
    if (mode === 'signup' && !result.data.session) { $('authStatus').textContent = 'Account created. Check your email to confirm it, then sign in.'; return; }
    session = result.data.session;
    if (session) { localStorage.setItem(LOCAL_ACCESS_KEY, '1'); showSignedIn(); await loadCloudData(); }
    else $('authStatus').textContent = 'Check your email if confirmation is required, then sign in.';
  }
  function formatDate(value) {
    if (!value) return 'Not set';
    const d = new Date(value.length === 10 ? value + 'T12:00:00' : value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, {day:'numeric', month:'short', year:'numeric'});
  }
  function taskDates(t) {
    const due = t.dueDate ? `Due ${formatDate(t.dueDate)}` : 'No due date';
    const created = `Created ${formatDate(t.createdAt)}`;
    const completedText = t.done ? ` · Completed ${formatDate(t.completedAt)}` : '';
    const overdue = !t.done && t.dueDate && t.dueDate < new Date().toISOString().slice(0,10);
    return `<div class="project-meta" class="project-meta task-date-meta">${escapeHtml(due)}${overdue ? ' · OVERDUE' : ''}<br>${escapeHtml(created)}${escapeHtml(completedText)}</div>`;
  }
  function makeTask(text, dueDate = '') {
    return {id:uid(), text, done:false, createdAt:new Date().toISOString(), dueDate, completedAt:'', plannedFor:''};
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function completed(p) { return p.tasks.filter(t => t.done).length; }
  function percent(p) { return p.tasks.length ? Math.round(completed(p) / p.tasks.length * 100) : 0; }
  function showView(name) {
    Object.entries(views).forEach(([key, el]) => el.classList.toggle('hidden', key !== name));
    window.scrollTo({top:0, behavior:'smooth'});
  }
  function showToast(message) {
    $('toast').textContent = message; $('toast').classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 2200);
  }
  function renderTodayTasks() {
    const all = [];
    projects.forEach(p => p.tasks.forEach(t => { if (t.plannedFor === todayKey()) all.push({...t, projectName:p.name, source:'project'}); }));
    standaloneTasks.forEach(t => { if (t.plannedFor === todayKey()) all.push({...t, projectName:'Standalone task', source:'standalone'}); });
    const visible = all.filter(t => !t.done || (t.completedAt && t.completedAt.slice(0,10) === todayKey()));
    $('todayCount').textContent = `${visible.filter(t=>!t.done).length} outstanding`;
    if (!visible.length) { $('todayTasks').innerHTML = '<div class="empty compact-empty"><p class="empty-message">Choose tasks from a project using “Do today”. They will appear here.</p></div>'; return; }
    $('todayTasks').innerHTML = visible.map(t => `<label class="task ${t.done?'done':''}"><input type="checkbox" data-today="${t.id}" data-source="${t.source}" ${t.done?'checked':''} aria-label="Mark ${escapeHtml(t.text)} complete"><span class="task-text">${escapeHtml(t.text)}<span class="today-project">${escapeHtml(t.projectName)}</span>${taskDates(t)}</span></label>`).join('');
    $('todayTasks').querySelectorAll('[data-today]').forEach(cb => cb.addEventListener('change', () => {
      const isProject = cb.dataset.source === 'project';
      const t = isProject ? projects.flatMap(p=>p.tasks).find(t=>t.id===cb.dataset.today) : standaloneTasks.find(t=>t.id===cb.dataset.today);
      if (!t) return; t.done=cb.checked; t.completedAt=cb.checked?new Date().toISOString():''; save(); renderTodayTasks(); renderHome(); if (isProject && currentId) renderTasks(); showToast(cb.checked?'Task completed':'Task reopened');
    }));
  }
  function renderHome() {
    renderTodayTasks();
    $('projectCount').textContent = `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`;
    if (!projects.length) {
      $('projects').innerHTML = `<div class="empty" class="empty full-grid-empty"><div class="emoji">✓</div><h3>Start with one small project</h3><p>Choose something you want to get done, then break it into manageable tasks.</p><button class="btn" id="emptyNewBtn">Create your first project</button></div>`;
      $('emptyNewBtn').addEventListener('click', () => openProjectForm());
      renderStandaloneTasks();
      return;
    }
    renderStandaloneTasks();
    $('projects').innerHTML = projects.map(p => `
      <article class="project-card">
        <div class="card-top">
          <div class="project-mark" aria-hidden="true">✓</div>
          <div class="project-main">
            <h3 class="project-title">${escapeHtml(p.name)}</h3>
            <div class="project-meta">${completed(p)} of ${p.tasks.length} tasks complete${p.tasks.length ? ` · ${percent(p)}%` : ''}</div>
          </div>
          <button class="open-project" data-open="${p.id}" aria-label="Open ${escapeHtml(p.name)}">›</button>
        </div>
        <div class="progress-track"><div class="progress-fill" style="--progress-width:${percent(p)}%"></div></div>

      </article>`).join('');
    $('projects').querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openProject(b.dataset.open)));
    $('projects').querySelectorAll('.project-card').forEach((card, i) => card.addEventListener('click', e => {
      if (!e.target.closest('button')) openProject(projects[i].id);
    }));
  }
  function renderStandaloneTasks() {
    $('standaloneCount').textContent = `${standaloneTasks.filter(t => !t.done).length} open`;
    if (!standaloneTasks.length) {
      $('standaloneTasks').innerHTML = '<div class="empty compact-empty"><p class="empty-message">No standalone tasks yet.</p></div>';
      return;
    }
    $('standaloneTasks').innerHTML = standaloneTasks.map(t => `
      <label class="task ${t.done ? 'done' : ''}">
        <input type="checkbox" data-standalone="${t.id}" ${t.done ? 'checked' : ''} aria-label="Mark ${escapeHtml(t.text)} complete">
        <span class="task-text">${escapeHtml(t.text)}${taskDates(t)}</span>
        <div class="task-buttons"><button type="button" class="small-action ${t.plannedFor === todayKey() ? 'selected' : ''}" data-plan-standalone="${t.id}">${t.plannedFor === todayKey() ? 'Today ✓' : 'Do today'}</button><button type="button" class="task-delete" data-delete-standalone="${t.id}" aria-label="Delete task">×</button></div>
      </label>`).join('');
    $('standaloneTasks').querySelectorAll('[data-standalone]').forEach(cb => cb.addEventListener('change', () => {
      const task = standaloneTasks.find(t => t.id === cb.dataset.standalone);
      if (task) { task.done = cb.checked; task.completedAt = cb.checked ? new Date().toISOString() : ''; save(); renderStandaloneTasks(); }
    }));
    $('standaloneTasks').querySelectorAll('[data-plan-standalone]').forEach(btn => btn.addEventListener('click', () => {
      const task = standaloneTasks.find(t => t.id === btn.dataset.planStandalone); if (!task) return;
      task.plannedFor = task.plannedFor === todayKey() ? '' : todayKey(); save(); renderHome(); showToast(task.plannedFor ? 'Added to today' : 'Removed from today');
    }));
    $('standaloneTasks').querySelectorAll('[data-delete-standalone]').forEach(btn => btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const task = standaloneTasks.find(t => t.id === btn.dataset.deleteStandalone);
      if (task && confirm(`Delete task “${task.text}”?`)) {
        addTombstone(DELETED_TASKS_KEY, task.id); standaloneTasks = standaloneTasks.filter(t => t.id !== task.id); save(); renderStandaloneTasks();
      }
    }));
  }
  function openProject(id) {
    currentId = id; const p = projects.find(x => x.id === id); if (!p) return;
    $('detailTitle').textContent = p.name;
    renderTasks(); $('projectNotes').value = p.notes;
    showView('project');
  }
  function renderTasks() {
    const p = projects.find(x => x.id === currentId); if (!p) return;
    $('detailTitle').textContent = p.name;
    $('detailProgress').textContent = `${completed(p)} of ${p.tasks.length} tasks complete${p.tasks.length ? ` · ${percent(p)}% finished` : ' · Add your first task below'}`;
    $('detailProgressFill').style.width = percent(p) + '%';
    if (!p.tasks.length) {
      $('taskList').innerHTML = '<div class="empty"><p class="empty-message">No tasks yet. Add the first step below.</p></div>';
    } else {
      $('taskList').innerHTML = p.tasks.map(t => `
        <label class="task ${t.done ? 'done' : ''}">
          <input type="checkbox" data-task="${t.id}" ${t.done ? 'checked' : ''} aria-label="Mark ${escapeHtml(t.text)} complete">
          <span class="task-text">${escapeHtml(t.text)}${taskDates(t)}</span>
          <div class="task-buttons"><button type="button" class="small-action ${t.plannedFor === todayKey() ? 'selected' : ''}" data-plan-task="${t.id}">${t.plannedFor === todayKey() ? 'Today ✓' : 'Do today'}</button><button type="button" class="task-delete" data-delete-task="${t.id}" aria-label="Delete task">×</button></div>
        </label>`).join('');
    }
    $('taskList').querySelectorAll('[data-task]').forEach(cb => cb.addEventListener('change', () => {
      const task = p.tasks.find(t => t.id === cb.dataset.task); if (task) {
        task.done = cb.checked;
        task.completedAt = cb.checked ? new Date().toISOString() : '';
        save(); renderTasks(); renderHome();
      }
    }));
    $('taskList').querySelectorAll('[data-plan-task]').forEach(btn => btn.addEventListener('click', () => {
      const task = p.tasks.find(t => t.id === btn.dataset.planTask); if (!task) return;
      task.plannedFor = task.plannedFor === todayKey() ? '' : todayKey(); save(); renderTasks(); renderHome(); showToast(task.plannedFor ? 'Added to today' : 'Removed from today');
    }));
    $('taskList').querySelectorAll('[data-delete-task]').forEach(btn => btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const task = p.tasks.find(t => t.id === btn.dataset.deleteTask);
      if (task && confirm(`Delete task “${task.text}”?`)) { addTombstone(DELETED_TASKS_KEY, task.id); p.tasks = p.tasks.filter(t => t.id !== task.id); save(); renderTasks(); renderHome(); }
    }));
  }
  function openProjectForm(id = null) {
    editingId = id;
    const p = id ? projects.find(x => x.id === id) : null;
    $('formHeading').textContent = p ? 'Edit project' : 'New project';
    $('saveProjectBtn').textContent = p ? 'Save changes' : 'Create project';
    $('projectName').value = p ? p.name : '';
    $('firstTasks').value = p ? p.tasks.map(t => t.text).join('\n') : '';
    $('firstTasks').disabled = !!p;
    showView('form'); $('projectName').focus();
  }
  function closeForm() {
    if (currentId && projects.some(p => p.id === currentId)) openProject(currentId);
    else { renderHome(); showView('home'); }
  }
  $('standaloneTaskForm').addEventListener('submit', e => {
    e.preventDefault();
    const text = $('standaloneTaskName').value.trim();
    if (!text) return;
    standaloneTasks.unshift(makeTask(text, $('standaloneDueDate').value));
    $('standaloneTaskName').value = '';
    $('standaloneDueDate').value = '';
    save(); renderStandaloneTasks(); showToast('Task added');
  });
  $('newProjectBtn').addEventListener('click', () => openProjectForm());
  $('backBtn').addEventListener('click', () => { renderHome(); showView('home'); });
  $('formBackBtn').addEventListener('click', closeForm);
  $('cancelFormBtn').addEventListener('click', closeForm);
  $('renameBtn').addEventListener('click', () => openProjectForm(currentId));
  $('projectForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('projectName').value.trim(); if (!name) return;
    if (editingId) {
      const p = projects.find(x => x.id === editingId);
      if (p) p.name = name;
      save(); currentId = editingId; openProject(currentId); showToast('Project updated');
    } else {
      const tasks = $('firstTasks').value.split('\n').map(s => s.trim()).filter(Boolean).map(text => makeTask(text));
      const p = {id:uid(), name, notes:'', createdAt:new Date().toISOString(), tasks};
      projects.unshift(p); save(); currentId = p.id; openProject(p.id); showToast('Project created');
    }
    editingId = null; $('firstTasks').disabled = false; renderHome();
  });
  $('addTaskForm').addEventListener('submit', e => {
    e.preventDefault(); const text = $('taskInput').value.trim(); if (!text) return;
    const p = projects.find(x => x.id === currentId); if (!p) return;
    p.tasks.push(makeTask(text)); $('taskInput').value = ''; save(); renderTasks(); renderHome();
  });
  let notesTimer;
  $('projectNotes').addEventListener('input', () => {
    const p = projects.find(x => x.id === currentId); if (!p) return;
    p.notes = $('projectNotes').value; save();
  });
  $('deleteProjectBtn').addEventListener('click', () => {
    const p = projects.find(x => x.id === currentId); if (!p) return;
    if (confirm(`Delete “${p.name}” and all its tasks? This cannot be undone.`)) {
      addTombstone(DELETED_PROJECTS_KEY, currentId);
      p.tasks.forEach(t => addTombstone(DELETED_TASKS_KEY, t.id));
      projects = projects.filter(x => x.id !== currentId); currentId = null; save(); renderHome(); showView('home'); showToast('Project deleted');
    }
  });
  async function refreshCloudState() {
    // Never start a cloud download while another sync is processing queued deletions.
    if (!db || !navigator.onLine || !session || isLoadingCloud || syncPromise) return;
    try {
      if (pendingSync) await syncToCloud();
      else await loadCloudData();
    } catch (_) {
      setSyncStatus(navigator.onLine ? 'Sync pending — retrying automatically' : 'Offline — changes saved on this device');
    }
  }
  window.addEventListener('online', async () => {
    if (!db) return;
    setSyncStatus('Connection restored — syncing…');
    try { const result = await db.auth.getSession(); if (result.error) throw result.error; session = result.data.session; if (session) await refreshCloudState(); else setSyncStatus('Online — sign in to resume cloud sync'); }
    catch (_) { setSyncStatus('Online — reconnecting to cloud…'); }
  });
  window.addEventListener('offline', () => setSyncStatus('Offline — changes saved on this device'));
  // Refresh cloud state automatically so changes made on another device appear without a manual browser refresh.
  // Poll only while the page is visible and online to avoid unnecessary requests in the background.
  window.setInterval(() => { if (!document.hidden) refreshCloudState(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCloudState(); });
  window.addEventListener('focus', () => refreshCloudState());
  window.addEventListener('pageshow', () => refreshCloudState());
  window.addEventListener('storage', e => { if (e.key === STORAGE_KEY) { projects = loadProjects(); renderHome(); } });
  $('authForm').addEventListener('submit', e => { e.preventDefault(); handleAuth('signin').catch(err => $('authStatus').textContent = err.message); });
  $('signUpBtn').addEventListener('click', () => handleAuth('signup').catch(err => $('authStatus').textContent = err.message));
  $('signOutBtn').addEventListener('click', async () => { if (db && navigator.onLine) { try { await db.auth.signOut(); } catch (_) {} } session=null; localStorage.removeItem(LOCAL_ACCESS_KEY); $('appRoot').classList.add('hidden'); $('authView').classList.remove('hidden'); $('authStatus').textContent='You have signed out.'; });
  function allowLocalOfflineAccess() {
    if (localStorage.getItem(LOCAL_ACCESS_KEY) !== '1') return false;
    showSignedIn();
    setSyncStatus(pendingSync ? 'Offline — changes waiting to sync' : 'Offline — showing saved data');
    return true;
  }
  if (!cloudReady) $('authStatus').textContent = 'Set up config.js with your Supabase URL and publishable key to begin.';
  else if (!navigator.onLine && allowLocalOfflineAccess()) { /* Previously authenticated on this device; show cached data without cloud access. */ }
  else {
    let initFinished = false;
    const fallbackTimer = setTimeout(() => { if (!initFinished && allowLocalOfflineAccess()) setSyncStatus('Offline — showing saved data; cloud connection unavailable'); }, 4000);
    db.auth.getSession().then(async ({data,error}) => {
      initFinished = true; clearTimeout(fallbackTimer);
      if (error) { if (!allowLocalOfflineAccess()) $('authStatus').textContent=error.message; else setSyncStatus('Offline — showing saved data; cloud connection unavailable'); return; }
      session=data.session; if (session) { localStorage.setItem(LOCAL_ACCESS_KEY, '1'); showSignedIn(); await loadCloudData(); }
      else if (!allowLocalOfflineAccess()) $('authStatus').textContent='Sign in while online once to enable offline access on this device.';
    }).catch(err => { initFinished=true; clearTimeout(fallbackTimer); if (!allowLocalOfflineAccess()) $('authStatus').textContent=err.message; else setSyncStatus('Offline — showing saved data; cloud connection unavailable'); });
  }
  renderHome();
  renderStandaloneTasks();
})();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
