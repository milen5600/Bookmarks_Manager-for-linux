// ============================================================
// Bookmark Manager — bookmarks.js
// Дърво, списък, breadcrumb, CRUD, търсене, пълно drag&drop,
// теми, проверка на линкове, импорт/експорт.
// Данните: localStorage (WEBKIT_USER_DATA_DIR в профила).
// ============================================================
(function () {
	'use strict';

	const STORAGE_KEY = 'bm_data_v1';
	const STATE_KEY = 'bm_state_v1';

	const THEMES = [
		{ id: 'dark', label: 'Тъмна (по подразбиране)', icon: '🌙', swatch: '#172332' },
		{ id: 'light', label: 'Светла (по подразбиране)', icon: '☀️', swatch: '#f4f6fa' },
		{ id: 'github-dark', label: 'GitHub тъмна', icon: '🐙', swatch: '#0d1117' },
		{ id: 'github-light', label: 'GitHub светла', icon: '🐙', swatch: '#f6f8fa' },
		{ id: 'solarized-dark', label: 'Solarized тъмна', icon: '🔆', swatch: '#002b36' },
		{ id: 'solarized-light', label: 'Solarized светла', icon: '🔆', swatch: '#fdf6e3' },
		{ id: 'vscode-dark', label: 'VS Code тъмна', icon: '💻', swatch: '#1e1e1e' },
		{ id: 'vscode-light', label: 'VS Code светла', icon: '💻', swatch: '#f3f3f3' },
	];

	const LINK_CHECK_TIMEOUT_MS = 8000;
	const LINK_CHECK_CONCURRENCY = 4;

	let root;
	let state;
	let dragPayload = null; // { id }

	// ------------------------------------------------------------
	// Helpers
	// ------------------------------------------------------------
	function uid() {
		return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
	}

	function defaultData() {
		return { id: 'root', type: 'folder', title: 'Начало', dateAdded: Date.now(), children: [] };
	}

	function escapeHtml(s) {
		return String(s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function sanitizeFilename(name) {
		return (name || 'bookmarks').replace(/[\\/:*?"<>|]/g, '_').trim() || 'bookmarks';
	}

	function formatDate(ts) {
		if (!ts) return '';
		try {
			const d = new Date(ts);
			return d.toLocaleDateString('bg-BG', { year: 'numeric', month: '2-digit', day: '2-digit' });
		} catch (e) {
			return '';
		}
	}

	function clearDropIndicators() {
		document.querySelectorAll('.drag-over, .drop-before, .drop-after, .drag-over-pane').forEach(el => {
			el.classList.remove('drag-over', 'drop-before', 'drop-after', 'drag-over-pane');
		});
	}

	function startDrag(e, id, element) {
		if (!id || !e.dataTransfer) return;
		dragPayload = { id };
		const payload = JSON.stringify({ id });
		// Използваме два типа данни: application/x-bookmark-manager е надеждният
		// вътрешен формат, а text/plain пази съвместимост с браузърите/системата.
		e.dataTransfer.clearData();
		e.dataTransfer.setData('application/x-bookmark-manager', payload);
		e.dataTransfer.setData('text/plain', payload);
		e.dataTransfer.effectAllowed = 'move';
		if (element) element.classList.add('dragging');
	}

	function endDrag(element) {
		if (element) element.classList.remove('dragging');
		dragPayload = null;
		clearDropIndicators();
	}

	// ------------------------------------------------------------
	// Load / save
	// ------------------------------------------------------------
	function load() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			root = raw ? JSON.parse(raw) : defaultData();
		} catch (e) {
			root = defaultData();
		}
		if (!root || root.type !== 'folder' || !Array.isArray(root.children)) {
			root = defaultData();
		}
		try {
			const raw2 = localStorage.getItem(STATE_KEY);
			state = raw2 ? JSON.parse(raw2) : {};
		} catch (e) {
			state = {};
		}
		state.expanded = state.expanded || {};
		state.selectedFolderId = state.selectedFolderId || 'root';
		state.selectedItemId = state.selectedItemId || null;
		state.treeWidth = state.treeWidth || 280;
		state.searchTerm = state.searchTerm || '';
		state.theme = state.theme || document.documentElement.getAttribute('data-theme') || 'dark';
		if (!THEMES.some(t => t.id === state.theme)) state.theme = 'dark';
		if (!findNode(state.selectedFolderId)) state.selectedFolderId = 'root';
	}

	function save() {
		try { localStorage.setItem(STORAGE_KEY, JSON.stringify(root)); } catch (e) { /* ignore */ }
	}

	function saveState() {
		try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
	}

	// ------------------------------------------------------------
	// Tree data helpers
	// ------------------------------------------------------------
	function findNode(id, node) {
		node = node || root;
		if (node.id === id) return node;
		if (node.children) {
			for (const c of node.children) {
				const r = findNode(id, c);
				if (r) return r;
			}
		}
		return null;
	}

	function findParent(id, node) {
		node = node || root;
		if (!node.children) return null;
		for (const c of node.children) {
			if (c.id === id) return node;
			const r = findParent(id, c);
			if (r) return r;
		}
		return null;
	}

	function isDescendant(maybeAncestorOrSelf, node) {
		if (maybeAncestorOrSelf.id === node.id) return true;
		if (!node.children) return false;
		return node.children.some(c => isDescendant(maybeAncestorOrSelf, c));
	}

	function getPath(id) {
		const path = [];
		let node = findNode(id);
		while (node) {
			path.unshift(node);
			if (node.id === 'root') break;
			node = findParent(node.id);
		}
		return path;
	}

	function searchAll(term) {
		term = term.toLowerCase();
		const results = [];
		(function walk(node) {
			for (const c of node.children) {
				const hay = c.title.toLowerCase() + ' ' + (c.type === 'bookmark' ? (c.url || '').toLowerCase() : '');
				if (hay.includes(term)) results.push(c);
				if (c.type === 'folder') walk(c);
			}
		})(root);
		return results;
	}

	function collectBookmarks(folderNode) {
		const list = [];
		(function walk(n) {
			for (const c of n.children || []) {
				if (c.type === 'bookmark') list.push(c);
				else if (c.type === 'folder') walk(c);
			}
		})(folderNode);
		return list;
	}

	// ------------------------------------------------------------
	// Move / reorder
	// ------------------------------------------------------------
	/**
	 * moveNode(id, targetFolderId, beforeId?)
	 * - targetFolderId: папката, в която отива елементът
	 * - beforeId: ако е зададен, вмъква преди този sibling; иначе append
	 * Работи и за пренареждане в същата папка (вкл. папки).
	 */
	function moveNode(id, targetFolderId, beforeId) {
		if (id === targetFolderId) return false;
		if (beforeId && beforeId === id) return false;
		const node = findNode(id);
		const target = findNode(targetFolderId);
		if (!node || !target || target.type !== 'folder') return false;
		if (node.type === 'folder' && isDescendant(node, target)) return false;

		const parent = findParent(id);
		if (!parent) return false;

		const fromIdx = parent.children.findIndex(c => c.id === id);
		if (fromIdx < 0) return false;

		// Целеви индекс ПРЕДИ премахването (ако е същата папка)
		let insertIdx;
		if (beforeId) {
			insertIdx = target.children.findIndex(c => c.id === beforeId);
			if (insertIdx < 0) insertIdx = target.children.length;
		} else {
			insertIdx = target.children.length;
		}

		// премахни от старата папка
		parent.children.splice(fromIdx, 1);

		// ако местим в същата папка и сме махнали елемент преди insertIdx — коригирай
		if (parent.id === target.id && fromIdx < insertIdx) {
			insertIdx -= 1;
		}

		insertIdx = Math.max(0, Math.min(insertIdx, target.children.length));
		target.children.splice(insertIdx, 0, node);

		save();
		renderTree();
		renderList();
		updateStatus();
		return true;
	}

	// ------------------------------------------------------------
	// Render: tree
	// ------------------------------------------------------------
	function renderTree() {
		const rootUl = document.getElementById('treeRoot');
		rootUl.innerHTML = '';
		const topFolders = root.children.filter(c => c.type === 'folder');
		for (const f of topFolders) rootUl.appendChild(renderTreeNode(f));
	}

	function wireTreePaneDrop() {
		const treePane = document.getElementById('treePane');
		const rootUl = document.getElementById('treeRoot');
		// drop върху празното място в дървото → root
		treePane.addEventListener('dragover', e => {
			if (e.target.closest('.node-row')) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = 'move';
		});
		treePane.addEventListener('drop', e => {
			if (e.target.closest('.node-row')) return;
			e.preventDefault();
			clearDropIndicators();
			const data = parseDragData(e);
			if (data && data.id) moveNode(data.id, 'root');
		});
		// също върху самия ul
		rootUl.addEventListener('dragover', e => {
			if (e.target.closest('.node-row')) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = 'move';
		});
		rootUl.addEventListener('drop', e => {
			if (e.target.closest('.node-row')) return;
			e.preventDefault();
			clearDropIndicators();
			const data = parseDragData(e);
			if (data && data.id) moveNode(data.id, 'root');
		});
	}

	function renderTreeNode(node) {
		const li = document.createElement('li');
		li.dataset.id = node.id;
		const expanded = !!state.expanded[node.id];
		if (expanded) li.classList.add('expanded');

		const row = document.createElement('div');
		row.className = 'node-row';
		if (node.id === state.selectedFolderId) row.classList.add('selected');

		const subFolders = node.children.filter(c => c.type === 'folder');
		if (subFolders.length) {
			const chev = document.createElement('span');
			chev.className = 'chev';
			chev.textContent = expanded ? '▼' : '▶';
			chev.addEventListener('click', e => { e.stopPropagation(); toggleExpand(node.id); });
			row.appendChild(chev);
		} else {
			const sp = document.createElement('span');
			sp.className = 'chev-spacer';
			row.appendChild(sp);
		}

		const icon = document.createElement('span');
		icon.className = 'icon';
		icon.textContent = '📁';
		row.appendChild(icon);

		const title = document.createElement('span');
		title.className = 'title';
		title.textContent = node.title;
		row.appendChild(title);

		const count = document.createElement('span');
		count.className = 'count';
		count.textContent = node.children.length ? String(node.children.length) : '';
		row.appendChild(count);

		row.addEventListener('click', () => selectFolder(node.id));
		row.addEventListener('dblclick', () => toggleExpand(node.id));
		row.addEventListener('contextmenu', e => {
			e.preventDefault();
			selectFolder(node.id);
			showTreeContextMenu(e, node);
		});

		// DnD — папките са пълноправни draggable елементи.
		// Задаваме draggable и като HTML атрибут, и като property, което
		// избягва различията между Chromium/WebKit при динамично създадени елементи.
		row.draggable = node.id !== 'root';
		if (node.id !== 'root') row.setAttribute('draggable', 'true');
		row.addEventListener('dragstart', e => {
			startDrag(e, node.id, row);
			row.style.opacity = '0.5';
		});
		row.addEventListener('dragend', () => {
			row.style.opacity = '';
			endDrag(row);
		});
		row.addEventListener('dragover', e => {
			if (!dragPayload && !e.dataTransfer.types.includes('application/x-bookmark-manager') && !e.dataTransfer.types.includes('text/plain')) return;
			e.preventDefault();
			e.stopPropagation();
			e.dataTransfer.dropEffect = 'move';
			clearDropIndicators();
			const rect = row.getBoundingClientRect();
			const y = e.clientY - rect.top;
			const h = rect.height;
			// 40% горе = преди, 40% долу = след, 20% среда = вътре
			if (y < h * 0.4) row.classList.add('drop-before');
			else if (y > h * 0.6) row.classList.add('drop-after');
			else row.classList.add('drag-over');
		});
		row.addEventListener('dragleave', () => {
			row.classList.remove('drag-over', 'drop-before', 'drop-after');
		});
		row.addEventListener('drop', e => {
			e.preventDefault();
			e.stopPropagation();
			const data = parseDragData(e);
			clearDropIndicators();
			if (!data || !data.id || data.id === node.id) return;
			const rect = row.getBoundingClientRect();
			const y = e.clientY - rect.top;
			const h = rect.height;
			const parentOfTarget = findParent(node.id);

			if (y >= h * 0.4 && y <= h * 0.6) {
				// в тази папка
				moveNode(data.id, node.id);
				state.expanded[node.id] = true;
				saveState();
				renderTree();
				return;
			}
			if (!parentOfTarget) return;
			if (y < h * 0.4) {
				// преди тази папка (в родителя ѝ)
				moveNode(data.id, parentOfTarget.id, node.id);
			} else {
				// след тази папка
				const siblings = parentOfTarget.children;
				const idx = siblings.findIndex(c => c.id === node.id);
				const next = idx >= 0 && idx + 1 < siblings.length ? siblings[idx + 1].id : null;
				moveNode(data.id, parentOfTarget.id, next);
			}
		});

		li.appendChild(row);

		if (subFolders.length) {
			const ul = document.createElement('ul');
			for (const sf of subFolders) ul.appendChild(renderTreeNode(sf));
			li.appendChild(ul);
		}
		return li;
	}

	function parseDragData(e) {
		try {
			const dt = e.dataTransfer;
			const raw = (dt && dt.getData('application/x-bookmark-manager')) ||
				(dt && dt.getData('text/plain'));
			if (raw) {
				const data = JSON.parse(raw);
				if (data && data.id) return data;
			}
		} catch (err) { /* ignore */ }
		return dragPayload;
	}

	function toggleExpand(id) {
		state.expanded[id] = !state.expanded[id];
		saveState();
		renderTree();
	}

	function selectFolder(id) {
		state.selectedFolderId = id;
		state.selectedItemId = null;
		state.searchTerm = '';
		document.getElementById('searchInput').value = '';
		saveState();
		renderTree();
		renderBreadcrumb();
		renderList();
		updateStatus();
		updateToolbarState();
	}

	// ------------------------------------------------------------
	// Breadcrumb
	// ------------------------------------------------------------
	function renderBreadcrumb() {
		const bc = document.getElementById('breadcrumb');
		bc.innerHTML = '';
		const path = getPath(state.selectedFolderId);
		path.forEach((node, i) => {
			const span = document.createElement('span');
			span.className = 'crumb' + (i === path.length - 1 ? ' current' : '');
			span.textContent = node.title;
			if (i < path.length - 1) span.addEventListener('click', () => selectFolder(node.id));
			bc.appendChild(span);
			if (i < path.length - 1) {
				const sep = document.createElement('span');
				sep.className = 'sep';
				sep.textContent = '›';
				bc.appendChild(sep);
			}
		});
	}

	// ------------------------------------------------------------
	// List
	// ------------------------------------------------------------
	function renderList() {
		const tbody = document.getElementById('listBody');
		const table = document.getElementById('listTable');
		const empty = document.getElementById('emptyState');
		tbody.innerHTML = '';

		const searching = !!state.searchTerm;
		let items;
		if (searching) {
			items = searchAll(state.searchTerm);
		} else {
			const folder = findNode(state.selectedFolderId);
			items = folder ? folder.children.slice() : [];
		}

		if (!items.length) {
			table.classList.add('hidden');
			empty.classList.remove('hidden');
			empty.textContent = searching ? 'Няма намерени резултати.' : 'Няма елементи в тази папка.';
			return;
		}
		table.classList.remove('hidden');
		empty.classList.add('hidden');

		for (const item of items) tbody.appendChild(renderRow(item, searching));
	}

	function renderRow(item, showingSearch) {
		const tr = document.createElement('tr');
		tr.dataset.id = item.id;
		if (item.id === state.selectedItemId) tr.classList.add('selected');

		const tdName = document.createElement('td');
		tdName.className = 'col-name';
		const icon = document.createElement('span');
		icon.className = 'icon';
		icon.textContent = item.type === 'folder' ? '📁' : '🔖';
		tdName.appendChild(icon);
		if (item.type === 'bookmark') {
			const a = document.createElement('a');
			a.href = item.url;
			a.textContent = item.title;
			a.target = '_blank';
			a.rel = 'noopener noreferrer';
			a.addEventListener('click', e => e.stopPropagation());
			tdName.appendChild(a);
		} else {
			const span = document.createElement('span');
			span.className = 'folder-name';
			span.textContent = item.title;
			tdName.appendChild(span);
		}
		tr.appendChild(tdName);

		const tdUrl = document.createElement('td');
		tdUrl.className = 'col-url';
		tdUrl.textContent = item.type === 'bookmark' ? (item.url || '') : '';
		tr.appendChild(tdUrl);

		const tdDate = document.createElement('td');
		tdDate.className = 'col-date';
		tdDate.textContent = formatDate(item.dateAdded);
		tr.appendChild(tdDate);

		tr.addEventListener('click', () => {
			state.selectedItemId = item.id;
			saveState();
			renderList();
			updateStatus();
			updateToolbarState();
		});
		tr.addEventListener('dblclick', () => {
			if (item.type === 'folder') {
				selectFolder(item.id);
			} else if (item.type === 'bookmark') {
				window.open(item.url, '_blank');
			}
		});
		tr.addEventListener('contextmenu', e => {
			e.preventDefault();
			state.selectedItemId = item.id;
			renderList();
			showListContextMenu(e, item);
		});

		// DnD — както линковете, така и папките могат да се преместват и подреждат.
		tr.draggable = true;
		tr.setAttribute('draggable', 'true');
		tr.addEventListener('dragstart', e => {
			startDrag(e, item.id, tr);
			tr.style.opacity = '0.5';
		});
		tr.addEventListener('dragend', () => {
			tr.style.opacity = '';
			endDrag(tr);
		});
		tr.addEventListener('dragover', e => {
			if (!dragPayload && !e.dataTransfer.types.includes('application/x-bookmark-manager') && !e.dataTransfer.types.includes('text/plain')) return;
			e.preventDefault();
			e.stopPropagation();
			e.dataTransfer.dropEffect = 'move';
			clearDropIndicators();
			const rect = tr.getBoundingClientRect();
			const y = e.clientY - rect.top;
			const h = rect.height;
			// Папка: горна 40% = преди, долна 40% = след, средна 20% = вътре в папката
			// Отметка: горна половина = преди, долна = след
			if (item.type === 'folder') {
				if (y < h * 0.4) tr.classList.add('drop-before');
				else if (y > h * 0.6) tr.classList.add('drop-after');
				else tr.classList.add('drag-over');
			} else {
				if (y < h / 2) tr.classList.add('drop-before');
				else tr.classList.add('drop-after');
			}
		});
		tr.addEventListener('dragleave', () => {
			tr.classList.remove('drag-over', 'drop-before', 'drop-after');
		});
		tr.addEventListener('drop', e => {
			e.preventDefault();
			e.stopPropagation();
			const data = parseDragData(e);
			clearDropIndicators();
			if (!data || !data.id || data.id === item.id) return;

			const rect = tr.getBoundingClientRect();
			const y = e.clientY - rect.top;
			const h = rect.height;
			const currentFolderId = state.selectedFolderId;

			// Средна зона на папка → премести ВЪТРЕ в нея
			if (item.type === 'folder' && y >= h * 0.4 && y <= h * 0.6) {
				moveNode(data.id, item.id);
				state.expanded[item.id] = true;
				saveState();
				renderTree();
				return;
			}

			const insertBefore = (item.type === 'folder')
				? (y < h * 0.4)
				: (y < h / 2);

			function parentAndNext() {
				if (showingSearch) {
					const parent = findParent(item.id);
					if (!parent) return null;
					if (insertBefore) return { folderId: parent.id, beforeId: item.id };
					const siblings = parent.children;
					const idx = siblings.findIndex(c => c.id === item.id);
					const next = idx >= 0 && idx + 1 < siblings.length ? siblings[idx + 1].id : null;
					return { folderId: parent.id, beforeId: next };
				}
				if (insertBefore) return { folderId: currentFolderId, beforeId: item.id };
				const folder = findNode(currentFolderId);
				if (!folder) return null;
				const idx = folder.children.findIndex(c => c.id === item.id);
				const next = idx >= 0 && idx + 1 < folder.children.length ? folder.children[idx + 1].id : null;
				return { folderId: currentFolderId, beforeId: next };
			}

			const dest = parentAndNext();
			if (dest) moveNode(data.id, dest.folderId, dest.beforeId);
		});

		return tr;
	}

	function wireListPaneDrop() {
		const listPane = document.getElementById('listPane');
		listPane.addEventListener('dragover', e => {
			e.preventDefault();
			e.dataTransfer.dropEffect = 'move';
			if (!e.target.closest('tr')) {
				listPane.classList.add('drag-over-pane');
			}
		});
		listPane.addEventListener('dragleave', e => {
			if (!listPane.contains(e.relatedTarget)) {
				listPane.classList.remove('drag-over-pane');
			}
		});
		listPane.addEventListener('drop', e => {
			e.preventDefault();
			listPane.classList.remove('drag-over-pane');
			clearDropIndicators();
			if (e.target.closest('tr')) return; // handled by row
			const data = parseDragData(e);
			if (data && data.id && !state.searchTerm) {
				moveNode(data.id, state.selectedFolderId);
			}
		});
	}

	// ------------------------------------------------------------
	// Status / toolbar
	// ------------------------------------------------------------
	function updateStatus() {
		const statusText = document.getElementById('statusText');
		if (state.searchTerm) {
			statusText.textContent = `Намерени резултати: ${searchAll(state.searchTerm).length}`;
			return;
		}
		const folder = findNode(state.selectedFolderId);
		if (!folder) { statusText.textContent = ''; return; }
		const folders = folder.children.filter(c => c.type === 'folder').length;
		const bms = folder.children.length - folders;
		statusText.textContent = `${folder.title} — ${bms} отметки, ${folders} папки`;
	}

	function updateToolbarState() {
		const hasSelection = !!state.selectedItemId || state.selectedFolderId !== 'root';
		document.getElementById('btnRename').disabled = !hasSelection;
		document.getElementById('btnDelete').disabled = !hasSelection;
		updateThemeButton();
	}

	function updateThemeButton() {
		const btn = document.getElementById('btnTheme');
		const t = THEMES.find(x => x.id === state.theme) || THEMES[0];
		btn.textContent = t.icon;
		btn.title = `Тема: ${t.label} (клик за смяна)`;
	}

	// ------------------------------------------------------------
	// Modal
	// ------------------------------------------------------------
	function closeModal() {
		document.getElementById('modalRoot').innerHTML = '';
	}

	function showModal({ title, fields = [], confirmLabel = 'ОК', onConfirm, message, danger = false, customBody }) {
		const modalRoot = document.getElementById('modalRoot');
		modalRoot.innerHTML = '';

		const backdrop = document.createElement('div');
		backdrop.className = 'modal-backdrop';
		const box = document.createElement('div');
		box.className = 'modal-box';

		const h3 = document.createElement('h3');
		h3.textContent = title;
		box.appendChild(h3);

		if (message) {
			const p = document.createElement('p');
			p.className = 'msg';
			p.textContent = message;
			box.appendChild(p);
		}

		if (customBody) {
			box.appendChild(customBody);
		}

		const inputs = {};
		fields.forEach(f => {
			const wrap = document.createElement('div');
			wrap.className = 'modal-field';
			const label = document.createElement('label');
			label.textContent = f.label;
			wrap.appendChild(label);
			const input = document.createElement('input');
			input.type = f.type || 'text';
			input.value = f.value || '';
			if (f.placeholder) input.placeholder = f.placeholder;
			wrap.appendChild(input);
			box.appendChild(wrap);
			inputs[f.name] = input;
		});

		const actions = document.createElement('div');
		actions.className = 'modal-actions';
		const cancelBtn = document.createElement('button');
		cancelBtn.type = 'button';
		cancelBtn.textContent = 'Отказ';
		cancelBtn.addEventListener('click', closeModal);
		const okBtn = document.createElement('button');
		okBtn.type = 'button';
		okBtn.className = 'primary' + (danger ? ' danger' : '');
		okBtn.textContent = confirmLabel;
		const confirmAction = () => {
			const values = {};
			for (const k in inputs) values[k] = inputs[k].value.trim();
			const result = onConfirm ? onConfirm(values) : true;
			if (result !== false) closeModal();
		};
		okBtn.addEventListener('click', confirmAction);
		actions.appendChild(cancelBtn);
		actions.appendChild(okBtn);
		box.appendChild(actions);

		backdrop.appendChild(box);
		backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
		modalRoot.appendChild(backdrop);

		function keyHandler(e) {
			if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', keyHandler); }
			if (e.key === 'Enter' && document.activeElement && document.activeElement.tagName === 'INPUT') {
				confirmAction();
			}
		}
		document.addEventListener('keydown', keyHandler);

		const first = box.querySelector('input');
		if (first) setTimeout(() => first.focus(), 30);

		return { box, close: closeModal };
	}

	// ------------------------------------------------------------
	// Context menu
	// ------------------------------------------------------------
	let outsideCtxHandlerRef = null;

	function closeContextMenu() {
		const el = document.querySelector('.ctx-menu');
		if (el) el.remove();
		if (outsideCtxHandlerRef) {
			document.removeEventListener('mousedown', outsideCtxHandlerRef);
			outsideCtxHandlerRef = null;
		}
	}

	function showContextMenu(x, y, items) {
		closeContextMenu();
		const menu = document.createElement('div');
		menu.className = 'ctx-menu';
		menu.setAttribute('role', 'menu');
		items.forEach(it => {
			if (it.sep) {
				const sep = document.createElement('div');
				sep.className = 'sep';
				menu.appendChild(sep);
				return;
			}
			const item = document.createElement('div');
			item.className = 'item' + (it.disabled ? ' disabled' : '');
			item.textContent = it.label;
			item.setAttribute('role', 'menuitem');
			if (!it.disabled) {
				item.addEventListener('click', () => { closeContextMenu(); it.action(); });
			}
			menu.appendChild(item);
		});
		document.body.appendChild(menu);

		const rect = menu.getBoundingClientRect();
		let left = x, top = y;
		if (left + rect.width > window.innerWidth) left = Math.max(4, window.innerWidth - rect.width - 4);
		if (top + rect.height > window.innerHeight) top = Math.max(4, window.innerHeight - rect.height - 4);
		menu.style.left = left + 'px';
		menu.style.top = top + 'px';

		outsideCtxHandlerRef = e => { if (!menu.contains(e.target)) closeContextMenu(); };
		setTimeout(() => document.addEventListener('mousedown', outsideCtxHandlerRef), 0);
	}

	function showTreeContextMenu(e, node) {
		showContextMenu(e.clientX, e.clientY, [
			{ label: '📁+ Нова папка', action: () => newFolder() },
			{ label: '🔖+ Нова отметка', action: () => newBookmark() },
			{ sep: true },
			{ label: '✎ Преименувай', disabled: node.id === 'root', action: () => renameNode(node.id) },
			{ label: '🗑 Изтрий', disabled: node.id === 'root', action: () => deleteNode(node.id) },
			{ sep: true },
			{ label: '🔗 Провери линковете в папката', action: () => checkLinksInFolder(node.id) },
			{ label: '⇪ Експортирай папката', action: () => exportFolder(node.id) },
		]);
	}

	function showListContextMenu(e, item) {
		const opts = [];
		if (item.type === 'folder') {
			opts.push({ label: 'Отвори', action: () => selectFolder(item.id) });
			opts.push({ sep: true });
		}
		if (item.type === 'bookmark') {
			opts.push({ label: '📋 Копирай връзката', action: () => copyLink(item.url) });
			opts.push({ label: '🔗 Провери връзката', action: () => checkSingleLink(item) });
			opts.push({ sep: true });
		}
		opts.push({ label: '✎ Преименувай', action: () => renameNode(item.id) });
		opts.push({ label: '🗑 Изтрий', action: () => deleteNode(item.id) });
		if (item.type === 'folder') {
			opts.push({ sep: true });
			opts.push({ label: '🔗 Провери линковете в папката', action: () => checkLinksInFolder(item.id) });
			opts.push({ label: '⇪ Експортирай папката', action: () => exportFolder(item.id) });
		}
		showContextMenu(e.clientX, e.clientY, opts);
	}

	function copyLink(url) {
		if (!url) return;
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(url).then(() => {
				const st = document.getElementById('statusText');
				const prev = st.textContent;
				st.textContent = 'Връзката е копирана.';
				setTimeout(() => { st.textContent = prev; }, 1800);
			}).catch(() => fallbackCopy(url));
		} else {
			fallbackCopy(url);
		}
	}

	function fallbackCopy(text) {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.left = '-9999px';
		document.body.appendChild(ta);
		ta.select();
		try { document.execCommand('copy'); } catch (e) { /* ignore */ }
		document.body.removeChild(ta);
		const st = document.getElementById('statusText');
		const prev = st.textContent;
		st.textContent = 'Връзката е копирана.';
		setTimeout(() => { st.textContent = prev; }, 1800);
	}

	// ------------------------------------------------------------
	// Link checker
	// ------------------------------------------------------------
	function checkSingleLink(item) {
		showCheckResultsModal([item], `Проверка: ${item.title}`);
	}

	function checkLinksInFolder(folderId) {
		const folder = findNode(folderId);
		if (!folder) return;
		const bms = collectBookmarks(folder);
		if (!bms.length) {
			showModal({
				title: 'Проверка на линкове',
				message: 'В тази папка (и подпапките ѝ) няма отметки.',
				confirmLabel: 'ОК',
				onConfirm: () => true
			});
			return;
		}
		showCheckResultsModal(bms, `Проверка на линкове — ${folder.title} (${bms.length})`);
	}

	function showCheckResultsModal(bookmarks, title) {
		const wrap = document.createElement('div');
		const info = document.createElement('p');
		info.className = 'msg';
		info.textContent = 'Проверяват се връзките. Някои сайтове блокират CORS или зареждат бавно — таймаутът е ' + (LINK_CHECK_TIMEOUT_MS / 1000) + ' с. Резултат „неясен“ означава, че заявката е минала, но статусът не може да се прочете.';
		wrap.appendChild(info);

		const progress = document.createElement('p');
		progress.className = 'msg';
		progress.textContent = 'Изчакване…';
		wrap.appendChild(progress);

		const resultsDiv = document.createElement('div');
		resultsDiv.className = 'check-results';
		const table = document.createElement('table');
		const tbody = document.createElement('tbody');
		table.appendChild(tbody);
		resultsDiv.appendChild(table);
		wrap.appendChild(resultsDiv);

		const rows = {};
		bookmarks.forEach(bm => {
			const tr = document.createElement('tr');
			tr.innerHTML =
				`<td class="title-cell">${escapeHtml(bm.title)}</td>` +
				`<td class="url-cell">${escapeHtml(bm.url || '')}</td>` +
				`<td class="status-checking">…</td>`;
			tbody.appendChild(tr);
			rows[bm.id] = tr.lastElementChild;
		});

		showModal({
			title,
			customBody: wrap,
			confirmLabel: 'Затвори',
			onConfirm: () => true
		});

		runLinkChecks(bookmarks, (bm, result) => {
			const cell = rows[bm.id];
			if (!cell) return;
			cell.className = '';
			if (result.status === 'ok') {
				cell.className = 'status-ok';
				cell.textContent = result.code ? `OK (${result.code})` : 'OK';
			} else if (result.status === 'fail') {
				cell.className = 'status-fail';
				cell.textContent = 'Неработеше' + (result.error ? `: ${result.error}` : '');
			} else if (result.status === 'timeout') {
				cell.className = 'status-timeout';
				cell.textContent = 'Таймаут';
			} else {
				cell.className = 'status-timeout';
				cell.textContent = 'Неясен (CORS/opaque)';
			}
		}, (done, total) => {
			progress.textContent = `Проверени ${done} / ${total}…`;
			if (done >= total) progress.textContent = `Готово: ${total} връзки.`;
		});
	}

	async function checkOneUrl(url) {
		if (!url || !/^https?:\/\//i.test(url)) {
			return { status: 'fail', error: 'невалиден URL' };
		}
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), LINK_CHECK_TIMEOUT_MS);
		try {
			// Първо опит с cors (ако сървърът позволява)
			let res;
			try {
				res = await fetch(url, {
					method: 'HEAD',
					mode: 'cors',
					redirect: 'follow',
					signal: controller.signal,
					cache: 'no-store',
				});
				clearTimeout(timer);
				if (res.ok || (res.status >= 200 && res.status < 400)) {
					return { status: 'ok', code: res.status };
				}
				// някои сайтове не приемат HEAD
				if (res.status === 405 || res.status === 501) {
					return await checkOneUrlGet(url);
				}
				return { status: 'fail', code: res.status, error: 'HTTP ' + res.status };
			} catch (corsErr) {
				// fallback no-cors
				clearTimeout(timer);
				return await checkOneUrlNoCors(url);
			}
		} catch (err) {
			clearTimeout(timer);
			if (err && err.name === 'AbortError') return { status: 'timeout' };
			return { status: 'fail', error: (err && err.message) || 'грешка' };
		}
	}

	async function checkOneUrlGet(url) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), LINK_CHECK_TIMEOUT_MS);
		try {
			const res = await fetch(url, {
				method: 'GET',
				mode: 'cors',
				redirect: 'follow',
				signal: controller.signal,
				cache: 'no-store',
			});
			clearTimeout(timer);
			if (res.ok || (res.status >= 200 && res.status < 400)) {
				return { status: 'ok', code: res.status };
			}
			return { status: 'fail', code: res.status, error: 'HTTP ' + res.status };
		} catch (err) {
			clearTimeout(timer);
			if (err && err.name === 'AbortError') return { status: 'timeout' };
			return await checkOneUrlNoCors(url);
		}
	}

	async function checkOneUrlNoCors(url) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), LINK_CHECK_TIMEOUT_MS);
		try {
			await fetch(url, {
				method: 'GET',
				mode: 'no-cors',
				redirect: 'follow',
				signal: controller.signal,
				cache: 'no-store',
			});
			clearTimeout(timer);
			// opaque response — заявката е стигнала до мрежата
			return { status: 'uncertain' };
		} catch (err) {
			clearTimeout(timer);
			if (err && err.name === 'AbortError') return { status: 'timeout' };
			return { status: 'fail', error: (err && err.message) || 'мрежова грешка' };
		}
	}

	async function runLinkChecks(bookmarks, onResult, onProgress) {
		let done = 0;
		const total = bookmarks.length;
		const queue = bookmarks.slice();
		async function worker() {
			while (queue.length) {
				const bm = queue.shift();
				const result = await checkOneUrl(bm.url);
				done++;
				onResult(bm, result);
				onProgress(done, total);
			}
		}
		const workers = [];
		for (let i = 0; i < Math.min(LINK_CHECK_CONCURRENCY, total); i++) {
			workers.push(worker());
		}
		await Promise.all(workers);
	}

	// ------------------------------------------------------------
	// CRUD
	// ------------------------------------------------------------
	function newFolder() {
		const parent = findNode(state.selectedFolderId) || root;
		showModal({
			title: 'Нова папка',
			fields: [{ name: 'title', label: 'Име на папката', value: '' }],
			confirmLabel: 'Създай',
			onConfirm: (v) => {
				if (!v.title) return false;
				parent.children.push({ id: uid(), type: 'folder', title: v.title, dateAdded: Date.now(), children: [] });
				save(); renderTree(); renderList(); updateStatus();
			}
		});
	}

	function newBookmark() {
		const parent = findNode(state.selectedFolderId) || root;
		showModal({
			title: 'Нова отметка',
			fields: [
				{ name: 'title', label: 'Заглавие', value: '' },
				{ name: 'url', label: 'Адрес (URL)', value: 'https://' }
			],
			confirmLabel: 'Създай',
			onConfirm: (v) => {
				if (!v.title || !v.url) return false;
				parent.children.push({ id: uid(), type: 'bookmark', title: v.title, url: v.url, dateAdded: Date.now() });
				save(); renderList(); updateStatus();
			}
		});
	}

	function renameNode(id) {
		const node = findNode(id);
		if (!node || node.id === 'root') return;
		const fields = [{ name: 'title', label: 'Име', value: node.title }];
		if (node.type === 'bookmark') fields.push({ name: 'url', label: 'Адрес (URL)', value: node.url });
		showModal({
			title: 'Преименувай',
			fields,
			confirmLabel: 'Запази',
			onConfirm: (v) => {
				if (!v.title) return false;
				node.title = v.title;
				if (node.type === 'bookmark' && v.url) node.url = v.url;
				save(); renderTree(); renderBreadcrumb(); renderList(); updateStatus();
			}
		});
	}

	function deleteNode(id) {
		const node = findNode(id);
		if (!node || node.id === 'root') return;
		const parent = findParent(id);
		if (!parent) return;
		showModal({
			title: 'Изтриване',
			message: `Наистина ли искате да изтриете „${node.title}“?` +
				(node.type === 'folder' && node.children.length ? ' Съдържанието на папката ще бъде изтрито заедно с нея.' : ''),
			confirmLabel: 'Изтрий',
			danger: true,
			onConfirm: () => {
				parent.children = parent.children.filter(c => c.id !== id);
				if (state.selectedFolderId === id) state.selectedFolderId = parent.id;
				if (state.selectedItemId === id) state.selectedItemId = null;
				save(); saveState();
				renderTree(); renderBreadcrumb(); renderList(); updateStatus(); updateToolbarState();
			}
		});
	}

	// ------------------------------------------------------------
	// Themes
	// ------------------------------------------------------------
	function applyTheme(id) {
		if (!THEMES.some(t => t.id === id)) id = 'dark';
		document.documentElement.setAttribute('data-theme', id);
		state.theme = id;
		saveState();
		updateThemeButton();
	}

	function showThemePicker() {
		const grid = document.createElement('div');
		grid.className = 'theme-grid';
		THEMES.forEach(t => {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'theme-opt' + (t.id === state.theme ? ' active' : '');
			btn.innerHTML = `<span class="theme-swatch" style="background:${t.swatch}"></span><span>${escapeHtml(t.label)}</span>`;
			btn.addEventListener('click', () => {
				applyTheme(t.id);
				closeModal();
			});
			grid.appendChild(btn);
		});
		showModal({
			title: 'Избор на тема',
			customBody: grid,
			confirmLabel: 'Затвори',
			onConfirm: () => true
		});
	}

	// ------------------------------------------------------------
	// Import / export
	// ------------------------------------------------------------
	function parseDate(v) {
		if (!v) return Date.now();
		const n = parseInt(v, 10);
		if (!isNaN(n) && n > 0) return n * 1000;
		return Date.now();
	}

	function parseDl(dl) {
		const result = [];
		for (const dt of Array.from(dl.children)) {
			if (dt.tagName !== 'DT') continue;
			const h3 = dt.querySelector(':scope > h3');
			const a = dt.querySelector(':scope > a');
			if (h3) {
				const sub = { id: uid(), type: 'folder', title: h3.textContent.trim() || 'Папка', dateAdded: parseDate(h3.getAttribute('add_date')), children: [] };
				const childDl = dt.querySelector(':scope > dl');
				if (childDl) sub.children = parseDl(childDl);
				result.push(sub);
			} else if (a) {
				result.push({
					id: uid(), type: 'bookmark',
					title: a.textContent.trim() || a.getAttribute('href') || 'Отметка',
					url: a.getAttribute('href') || '#',
					dateAdded: parseDate(a.getAttribute('add_date'))
				});
			}
		}
		return result;
	}

	function parseNetscapeHTML(text, filename) {
		const doc = new DOMParser().parseFromString(text, 'text/html');
		const titleEl = doc.querySelector('title') || doc.querySelector('h1');
		const name = (titleEl && titleEl.textContent.trim()) || filename.replace(/\.[^.]+$/, '');
		const topDl = doc.querySelector('dl');
		const folder = { id: uid(), type: 'folder', title: name, dateAdded: Date.now(), children: [] };
		if (topDl) folder.children = parseDl(topDl);
		return folder;
	}

	function cloneNodes(nodes) {
		return (nodes || []).map(n => {
			if (n && n.type === 'folder') {
				return { id: uid(), type: 'folder', title: n.title || 'Папка', dateAdded: n.dateAdded || Date.now(), children: cloneNodes(n.children) };
			}
			return { id: uid(), type: 'bookmark', title: (n && n.title) || 'Отметка', url: (n && n.url) || '#', dateAdded: (n && n.dateAdded) || Date.now() };
		});
	}

	function parseJSONImport(text, filename) {
		const data = JSON.parse(text);
		let children = [];
		if (Array.isArray(data)) children = cloneNodes(data);
		else if (data && data.children) children = cloneNodes(data.children);
		else if (data && data.type === 'folder') children = cloneNodes([data]);
		const name = (data && data.title) || filename.replace(/\.[^.]+$/, '') || 'Импорт';
		return { id: uid(), type: 'folder', title: name, dateAdded: Date.now(), children };
	}

	function handleImportFile(file) {
		const reader = new FileReader();
		reader.onload = () => {
			try {
				const text = String(reader.result || '');
				let folder;
				if (/\.json$/i.test(file.name) || text.trim().startsWith('{') || text.trim().startsWith('[')) {
					folder = parseJSONImport(text, file.name);
				} else {
					folder = parseNetscapeHTML(text, file.name);
				}
				root.children.push(folder);
				save();
				state.expanded[folder.id] = true;
				saveState();
				renderTree();
				renderList();
				updateStatus();
				const st = document.getElementById('statusText');
				st.textContent = `Импортирано: ${folder.title}`;
			} catch (err) {
				showModal({
					title: 'Грешка при импорт',
					message: 'Файлът не можа да бъде прочетен. ' + (err && err.message ? err.message : ''),
					confirmLabel: 'ОК',
					onConfirm: () => true
				});
			}
		};
		reader.readAsText(file);
	}

	function nodeToNetscape(node, indent) {
		indent = indent || '';
		if (node.type === 'bookmark') {
			const add = node.dateAdded ? Math.floor(node.dateAdded / 1000) : '';
			return `${indent}<DT><A HREF="${escapeHtml(node.url)}" ADD_DATE="${add}">${escapeHtml(node.title)}</A>\n`;
		}
		let out = `${indent}<DT><H3>${escapeHtml(node.title)}</H3>\n${indent}<DL><p>\n`;
		for (const c of node.children || []) out += nodeToNetscape(c, indent + '    ');
		out += `${indent}</DL><p>\n`;
		return out;
	}

	function buildNetscapeFile(folderNode) {
		let body = '';
		if (folderNode.id === 'root') {
			for (const c of folderNode.children) body += nodeToNetscape(c, '    ');
		} else {
			body = nodeToNetscape(folderNode, '    ');
		}
		return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n` +
			`<!-- This is an automatically generated file. -->\n` +
			`<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n` +
			`<TITLE>Bookmarks</TITLE>\n` +
			`<H1>Bookmarks</H1>\n` +
			`<DL><p>\n${body}</DL><p>\n`;
	}

	function downloadText(filename, text, mime) {
		const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	}

	function exportFolder(id) {
		const node = findNode(id);
		if (!node) return;
		const name = sanitizeFilename(node.title) + '.html';
		downloadText(name, buildNetscapeFile(node), 'text/html;charset=utf-8');
	}

	function exportAll() {
		downloadText('bookmarks-all.html', buildNetscapeFile(root), 'text/html;charset=utf-8');
	}

	// ------------------------------------------------------------
	// Resizer
	// ------------------------------------------------------------
	function initResizer() {
		const resizer = document.getElementById('resizer');
		const treePane = document.getElementById('treePane');
		treePane.style.width = state.treeWidth + 'px';
		let dragging = false;
		resizer.addEventListener('mousedown', e => {
			e.preventDefault();
			dragging = true;
			resizer.classList.add('dragging');
			document.body.style.cursor = 'col-resize';
		});
		document.addEventListener('mousemove', e => {
			if (!dragging) return;
			const x = e.clientX;
			const w = Math.max(160, Math.min(window.innerWidth * 0.55, x));
			treePane.style.width = w + 'px';
			state.treeWidth = w;
		});
		document.addEventListener('mouseup', () => {
			if (dragging) {
				dragging = false;
				resizer.classList.remove('dragging');
				document.body.style.cursor = '';
				saveState();
			}
		});
	}

	// ------------------------------------------------------------
	// Toolbar wiring
	// ------------------------------------------------------------
	function wireToolbar() {
		document.getElementById('btnNewFolder').addEventListener('click', newFolder);
		document.getElementById('btnNewBookmark').addEventListener('click', newBookmark);
		document.getElementById('btnRename').addEventListener('click', () => {
			const id = state.selectedItemId || (state.selectedFolderId !== 'root' ? state.selectedFolderId : null);
			if (id) renameNode(id);
		});
		document.getElementById('btnDelete').addEventListener('click', () => {
			const id = state.selectedItemId || (state.selectedFolderId !== 'root' ? state.selectedFolderId : null);
			if (id) deleteNode(id);
		});

		document.getElementById('btnImport').addEventListener('click', () => document.getElementById('importInput').click());
		document.getElementById('importInput').addEventListener('change', e => {
			const file = e.target.files && e.target.files[0];
			if (file) handleImportFile(file);
			e.target.value = '';
		});

		document.getElementById('btnExport').addEventListener('click', () => exportFolder(state.selectedFolderId));
		document.getElementById('btnExportAll').addEventListener('click', exportAll);

		document.getElementById('btnTheme').addEventListener('click', showThemePicker);

		let searchDebounce;
		document.getElementById('searchInput').addEventListener('input', e => {
			clearTimeout(searchDebounce);
			const value = e.target.value;
			searchDebounce = setTimeout(() => {
				state.searchTerm = value.trim();
				saveState();
				renderList();
				updateStatus();
			}, 120);
		});

		document.addEventListener('keydown', e => {
			const tag = document.activeElement && document.activeElement.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA') return;
			if (document.querySelector('.modal-backdrop')) return;
			if (e.key === 'Delete') {
				const id = state.selectedItemId || (state.selectedFolderId !== 'root' ? state.selectedFolderId : null);
				if (id) deleteNode(id);
			}
		});
	}

	function init() {
		load();
		applyTheme(state.theme);
		document.getElementById('searchInput').value = state.searchTerm;

		renderTree();
		renderBreadcrumb();
		renderList();
		updateStatus();
		updateToolbarState();

		initResizer();
		wireToolbar();
		wireListPaneDrop();
		wireTreePaneDrop();
	}

	document.addEventListener('DOMContentLoaded', init);
})();
