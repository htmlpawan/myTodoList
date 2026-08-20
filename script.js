/**
 * Todo List Application Script
 * Vanilla JavaScript (ES6+) with Supabase persistence,
 * real-time filtering, search, inline editing, statistics,
 * and a full-page "deleted items" table modal (restore / permanently delete).
 */
const SUPABASE_URL = 'https://uohtbbdehjskdpmoykrr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_TrQxF_JcluMbyOraDq7KZQ_uFYtTnbB'; // safe to expose client-side

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(function () {
  'use strict';

  // --- Constants & Config ---
  const STORAGE_KEY = 'todo_app_tasks_v1';

  // --- Application State ---
  let tasks = [];
  let tasksDeleted = [];
  let currentFilter = 'all'; // 'all' | 'active' | 'completed'
  let searchQuery = '';
  let editingTaskId = null;

  // --- DOM Elements ---
  const todoForm = document.getElementById('todo-form');
  const taskInput = document.getElementById('task-input');
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('clear-search-btn');
  const filterBtns = document.querySelectorAll('.filter-btn');
  const taskList = document.getElementById('task-list');
  const emptyState = document.getElementById('empty-state');
  const emptyTitle = document.getElementById('empty-title');
  const emptySubtitle = document.getElementById('empty-subtitle');
  const clearCompletedBtn = document.getElementById('clear-completed-btn');

  // Stat Elements
  const statTotal = document.getElementById('stat-total');
  const statPending = document.getElementById('stat-pending');
  const statCompleted = document.getElementById('stat-completed');
  const countAll = document.getElementById('count-all');
  const countActive = document.getElementById('count-active');
  const countCompleted = document.getElementById('count-completed');

  // List Modal Elements
  const listTitleTrigger = document.getElementById('list-title-trigger');
  const listModalOverlay = document.getElementById('list-modal-overlay');
  const listModalClose = document.getElementById('list-modal-close');
  const listModalTbody = document.getElementById('list-modal-tbody');
  const listModalEmpty = document.getElementById('list-modal-empty');
  let isListModalOpen = false;

  // --- Storage Helper Functions ---
  async function loadTasks() {
    try {
      tasks = await loadTasksDB();
      saveTasks();

      tasksDeleted = await loadTasksDeletedDB();
    } catch (e) {
      console.error('Failed to load tasks:', e);
    }
  }

  async function saveTasks() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) {
      console.error('Failed to save tasks to localStorage:', e);
    }
  }

  // --- Task Operations ---
  function addTask(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const newTask = {
      id: 'task-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      text: trimmed,
      completed: false,
    };

    tasks.unshift(newTask); // Add to top of list
    addTaskDB(newTask);
    saveTasks();
    render();
  }

  function toggleTask(id) {
    tasks = tasks.map((task) => {
      if (task.id === id) {
        toggleTaskDB(id, !task.completed);
        return { ...task, completed: !task.completed };
      }
      return task;
    });
    saveTasks();
    render();
  }

  function deleteTask(id) {
    deleteTaskDB(id); // soft delete (status = 1)
    const taskElement = document.querySelector(`[data-id="${id}"]`);
    if (taskElement) {
      taskElement.classList.add('removing');
      setTimeout(() => {
        tasks = tasks.filter((task) => task.id !== id);
        saveTasks();
        render();
      }, 250);
    } else {
      tasks = tasks.filter((task) => task.id !== id);
      saveTasks();
      render();
    }
  }

  function startEditTask(id) {
    editingTaskId = id;
    render();
  }

  function saveEditTask(id, newText) {
    updateTextDB(id, newText);
    const trimmed = newText.trim();
    if (trimmed) {
      tasks = tasks.map((task) => {
        if (task.id === id) {
          return { ...task, text: trimmed };
        }
        return task;
      });
      saveTasks();
    }
    editingTaskId = null;
    render();
  }

  function cancelEditTask() {
    editingTaskId = null;
    render();
  }

  function clearCompleted() {
    tasks = tasks.filter((task) => !task.completed);
    saveTasks();
    render();
  }

  // --- Restore / Permanently delete a soft-deleted task ---
  async function handleRestoreTask(id) {
    await restoreTask(id);
    // Move it back from tasksDeleted into tasks locally, then re-sync from DB
    await loadTasks();
    render(); // refreshes stats + main list
    renderListModalTable(); // refreshes the modal table
  }

  async function handleDeletePermanentTask(id) {
    await deletePermanentTask(id);
    tasksDeleted = tasksDeleted.filter((t) => t.id !== id);
    renderListModalTable();
  }

  // --- Filtering & Counting Helpers ---
  function getFilteredTasks() {
    return tasks.filter((task) => {
      if (currentFilter === 'active' && task.completed) return false;
      if (currentFilter === 'completed' && !task.completed) return false;

      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        return task.text.toLowerCase().includes(query);
      }

      return true;
    });
  }

  function updateStatistics() {
    const totalCount = tasks.length;
    const completedCount = tasks.filter((t) => t.completed).length;
    const pendingCount = totalCount - completedCount;

    statTotal.textContent = totalCount;
    statPending.textContent = pendingCount;
    statCompleted.textContent = completedCount;

    countAll.textContent = totalCount;
    countActive.textContent = pendingCount;
    countCompleted.textContent = completedCount;

    if (completedCount > 0) {
      clearCompletedBtn.classList.remove('hidden');
    } else {
      clearCompletedBtn.classList.add('hidden');
    }
  }

  // --- Rendering ---
  function render() {
    updateStatistics();
    const filteredTasks = getFilteredTasks();

    taskList.innerHTML = '';

    if (filteredTasks.length === 0) {
      taskList.classList.add('hidden');
      emptyState.classList.remove('hidden');

      if (searchQuery.trim()) {
        emptyTitle.textContent = 'No matching tasks';
        emptySubtitle.textContent = `No tasks found matching "${searchQuery.trim()}".`;
      } else if (currentFilter === 'active') {
        emptyTitle.textContent = 'No active tasks';
        emptySubtitle.textContent = 'Great job! You have completed all active tasks.';
      } else if (currentFilter === 'completed') {
        emptyTitle.textContent = 'No completed tasks';
        emptySubtitle.textContent = 'You haven\'t completed any tasks yet. Keep going!';
      } else {
        emptyTitle.textContent = 'No tasks found';
        emptySubtitle.textContent = 'You are all caught up! Add a new task above to get started.';
      }
    } else {
      taskList.classList.remove('hidden');
      emptyState.classList.add('hidden');

      filteredTasks.forEach((task) => {
        const li = document.createElement('li');
        li.className = `task-item ${task.completed ? 'completed' : ''}`;
        li.setAttribute('data-id', task.id);

        if (editingTaskId === task.id) {
          li.innerHTML = `
            <form class="edit-form" id="edit-form-${task.id}">
              <input 
                type="text" 
                class="edit-input" 
                value="${escapeHtml(task.text)}" 
                maxlength="200" 
                aria-label="Edit task text"
              />
              <button type="submit" class="save-btn" title="Save changes">Save</button>
              <button type="button" class="cancel-btn" title="Cancel edit">Cancel</button>
            </form>
          `;

          const editForm = li.querySelector('.edit-form');
          const editInput = li.querySelector('.edit-input');
          const cancelBtn = li.querySelector('.cancel-btn');

          setTimeout(() => {
            editInput.focus();
            editInput.setSelectionRange(editInput.value.length, editInput.value.length);
          }, 0);

          editForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveEditTask(task.id, editInput.value);
          });

          cancelBtn.addEventListener('click', () => {
            cancelEditTask();
          });

          editInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
              cancelEditTask();
            }
          });
        } else {
          li.innerHTML = `
            <div class="task-content">
              <label class="checkbox-container" title="${task.completed ? 'Mark incomplete' : 'Mark completed'}">
                <input type="checkbox" ${task.completed ? 'checked' : ''} aria-label="Toggle completed state" />
                <span class="checkmark"></span>
              </label>
              <span class="task-text" title="Double click to edit">${escapeHtml(task.text)}</span>
            </div>
            <div class="task-actions">
              <button type="button" class="action-btn edit-btn" title="Edit task" aria-label="Edit task">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <button type="button" class="action-btn delete-btn" title="Delete task" aria-label="Delete task">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          `;

          const checkbox = li.querySelector('input[type="checkbox"]');
          checkbox.addEventListener('change', () => toggleTask(task.id));

          const taskTextSpan = li.querySelector('.task-text');
          taskTextSpan.addEventListener('dblclick', () => startEditTask(task.id));

          const editBtn = li.querySelector('.edit-btn');
          editBtn.addEventListener('click', () => startEditTask(task.id));

          const deleteBtn = li.querySelector('.delete-btn');
          deleteBtn.addEventListener('click', () => deleteTask(task.id));
        }

        taskList.appendChild(li);
      });
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // --- List Modal (deleted items table) ---
  function renderListModalTable() {
    if (!listModalTbody) return;

    if (tasksDeleted.length === 0) {
      listModalTbody.innerHTML = '';
      listModalEmpty.classList.remove('hidden');
      return;
    }

    listModalEmpty.classList.add('hidden');
    listModalTbody.innerHTML = tasksDeleted
      .map((task) => {
        const statusClass = task.completed ? 'completed' : 'pending';
        const statusLabel = task.completed ? 'Completed' : 'Pending';
        // NOTE: data-id (not inline onclick) — avoids the global-scope
        // and unquoted-UUID issues that broke restore/delete before.
        return `
          <tr data-id="${escapeHtml(String(task.id))}">
            <td>${escapeHtml(task.text)}</td>
            <td><span class="list-status-badge ${statusClass}">${statusLabel}</span></td>
            <td class="restore-cell">
              <img src="restore.png" class="restore-btn" alt="Restore" width="24" height="24" style="cursor:pointer;" />
              <button type="button" class="action-btn delete-btn delete-permanent-btn" title="Delete permanently" aria-label="Delete permanently" style="color: red;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  async function openListModal() {
    tasksDeleted = await loadTasksDeletedDB();
    isListModalOpen = true;
    renderListModalTable();
    listModalOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeListModal() {
    isListModalOpen = false;
    listModalOverlay.classList.add('hidden');
    document.body.style.overflow = '';
    location.reload();
  }

  // --- Event Listeners Setup ---
  function initEventListeners() {
    todoForm.addEventListener('submit', (e) => {
      e.preventDefault();
      addTask(taskInput.value);
      taskInput.value = '';
      taskInput.focus();
    });

    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      if (searchQuery.trim().length > 0) {
        clearSearchBtn.classList.remove('hidden');
      } else {
        clearSearchBtn.classList.add('hidden');
      }
      render();
    });

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      clearSearchBtn.classList.add('hidden');
      searchInput.focus();
      render();
    });

    filterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        filterBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.getAttribute('data-filter');
        render();
      });
    });

    clearCompletedBtn.addEventListener('click', () => {
      clearCompleted();
    });

    // List Modal open/close
    if (listTitleTrigger) {
      listTitleTrigger.addEventListener('click', () => {
        openListModal();
      });
    }
    if (listModalClose) {
      listModalClose.addEventListener('click', () => {
        closeListModal();
      });
    }
    if (listModalOverlay) {
      listModalOverlay.addEventListener('click', (e) => {
        if (e.target === listModalOverlay) {
          closeListModal();
        }
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isListModalOpen) {
        closeListModal();
      }
    });

    // Restore / permanent-delete buttons inside the modal table
    // Event delegation: one listener on the tbody handles clicks on
    // any current or future row, reading the id from the row's data-id.
    if (listModalTbody) {
      listModalTbody.addEventListener('click', (e) => {
        const row = e.target.closest('tr[data-id]');
        if (!row) return;
        const id = row.getAttribute('data-id');

        if (e.target.closest('.restore-btn')) {
          handleRestoreTask(id);
          return;
        }
        if (e.target.closest('.delete-permanent-btn')) {
          handleDeletePermanentTask(id);
          return;
        }
      });
    }
  }

  // --- Initialization ---
  async function init() {
    await loadTasks();
    initEventListeners();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  //------------------------------------------------------------DB Functions------------------------------------
  async function loadTasksDB() {
    const { data, error } = await supabaseClient
      .from('tasks')
      .select('*')
      .eq('status', false)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch failed:', error);
      return [];
    }
    return data;
  }

  async function loadTasksDeletedDB() {
    const { data, error } = await supabaseClient
      .from('tasks')
      .select('*')
      .eq('status', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Fetch failed:', error);
      return [];
    }
    return data;
  }

  async function addTaskDB(dataJson) {
    const { data, error } = await supabaseClient
      .from('tasks')
      .insert([dataJson])
      .select();

    if (error) {
      console.error('Insert failed:', error);
      return null;
    }
    return data[0];
  }

  async function deleteTaskDB(id) {
    const { error } = await supabaseClient.from('tasks').update({ status: 1 }).eq('id', id);
    if (error) console.error('Delete failed:', error);
  }

  async function restoreTask(id) {
    const { error } = await supabaseClient.from('tasks').update({ status: 0 }).eq('id', id);
    if (error) console.error('Restore failed:', error);
  }

  async function deletePermanentTask(id) {
    const { error } = await supabaseClient.from('tasks').delete().eq('id', id);
    if (error) console.error('Permanent delete failed:', error);
  }

  async function toggleTaskDB(id, completed) {
    const { error } = await supabaseClient
      .from('tasks')
      .update({ completed: completed })
      .eq('id', id);
    if (error) console.error('Toggle failed:', error);
  }

  async function updateTextDB(id, text) {
    const { error } = await supabaseClient
      .from('tasks')
      .update({ text: text })
      .eq('id', id);
    if (error) console.error('Update failed:', error);
  }

  //------------------------------Service Worker Registration---------------------------------------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('sw.js')
        .then((reg) => console.log('Service Worker registered:', reg.scope))
        .catch((err) => console.error('Service Worker registration failed:', err));
    });
  }
})();