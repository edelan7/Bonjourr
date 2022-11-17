import clamp from 'lodash.clamp'
import clonedeep from 'lodash.clonedeep'
import storage from './storage'
import { Move, MoveKeys, MoveItem, Sync } from './types/sync'
import { syncDefaults, clas, $ } from './utils'

// ┌──────────────────────────────────────┐
// │   ┌────────────┐  ┌────────────┐     │
// │   │ Utils      ◄──┤ Funcs      ◄──┐  │
// │   └─────▲──────┘  └────▲───────┘  │  │
// │   ┌─────┴──────────────┴───────┐  │  │
// │   │ Updates                    │  │  │
// │   └────────────────────▲───────┘  │  │
// │   ┌─────────────┐      │          │  │
// │   │ On load     │      │          │  │
// │   │ ┌────────┐  │      │          │  │
// │   │ │ Init   ├──┼──────┼──────────┘  │
// │   │ └────────┘  │      │             │
// │   │ ┌────────┐  │      │             │
// │   │ │ Events ├──┼──────┘             │
// │   │ └────────┘  │                    │
// │   └─────────────┘                    │
// └──────────────────────────────────────┘

type InterfaceWidgetControl = {
	id: MoveKeys
	on: boolean
}

let smallWidth = false
const dominterface = document.querySelector<HTMLElement>('#interface')
const elements = {
	time: $('time'),
	main: $('main'),
	quicklinks: $('linkblocks'),
	searchbar: $('sb_container'),
	notes: $('notes_container'),
	quotes: $('quotes_container'),
}

export default function moveElements(init: Move | null, widget?: InterfaceWidgetControl) {
	let activeID: MoveKeys | null

	type Layout = Move['layouts'][keyof Move['layouts']]

	//
	// Utils
	//

	const isEditing = () => dominterface?.classList.contains('move-edit') || false

	const checkDuplicate = (arr: string[], id: string) => arr.filter((a) => a === id).length > 1

	function areaStringToLayoutGrid(area: string) {
		let rows = area.substring(1, area.length - 2).split('" "')
		let grid = rows.map((row) => row.replace('"', '').split(' '))
		return grid
	}

	function layoutToGridAreas(grid: Layout['grid']) {
		let areas = ``

		const itemListToString = (row: string[]) => row.reduce((a, b) => `${a} ${b}`) // 2
		grid.forEach((row: string[]) => (areas += `'${itemListToString(row)}' `)) // 1

		return areas
	}

	function isRowEmpty(grid: Layout['grid'], index: number) {
		if (grid[index]) {
			return grid[index].filter((col) => col !== '.').length === 0
		}

		return true
	}

	function getEnabledWidgetsFromStorage(data: Sync) {
		// Get each widget state from their specific storage
		let displayed = {
			quotes: !!data.quotes?.on,
			notes: !!data.notes?.on,
			searchbar: !!data.searchbar?.on,
			quicklinks: data.quicklinks,
		}

		return Object.entries(displayed)
			.filter(([key, val]) => val)
			.map(([key, val]) => key as MoveKeys)
	}

	function findIdPosition(grid: Layout['grid'], id: MoveKeys) {
		const flatIndex = grid.flat().findIndex((a) => a === id)
		return {
			posCol: flatIndex % grid.length,
			posRow: Math.floor(flatIndex / grid.length),
		}
	}

	//
	// Funcs
	//

	function setGridAreas(layout: Layout) {
		if (dominterface) {
			dominterface.style.setProperty('--grid', layoutToGridAreas(layout.grid))
		}
	}

	function setAlign(item: MoveItem, id: MoveKeys) {
		const elem = elements[id]
		if (elem) {
			if (typeof item?.box === 'string') elem.style.placeSelf = item.box
			if (typeof item?.text === 'string') elem.style.textAlign = item.text
		}
	}

	function setAllAligns(items: Layout['items']) {
		Object.keys(elements).forEach((key) => {
			if (key in items) {
				const id = key as MoveKeys
				setAlign(items[id], id)
			}
		})
	}

	function spansInGridArea(dir: 'row' | 'col', grid: Layout['grid'], id: MoveKeys) {
		//
		function fillArrayWithIds(arr: string[]) {
			let target = arr.indexOf(id)
			let stopper = [false, false]

			function replaceWithId(a: string[], i: number, lim: number) {
				// not stopping and elem exit
				if (!stopper[lim] && a[i]) {
					if (a[i] === '.') a[i] = id // replaces dot with id
					else if (a[i] !== id) stopper[lim] = true // other ? stop
				}

				return a
			}

			// in [., a, ., ., target, ., b, ., .]
			for (let ii = 1; ii < arr.length; ii++) {
				arr = replaceWithId(arr, target + ii, 0) // replaces until b
				arr = replaceWithId(arr, target - ii, 1) // replaces until a
			}

			return arr
		}

		function removeDuplicateIds(arr: string[]) {
			let keepfirst = true
			return arr.map((a) => {
				if (a === id) {
					if (keepfirst) keepfirst = false
					else return '.'
				}
				return a
			})
		}

		/*
		 	For columns and rows:
			mutate column by adding / removing duplicates 
			mutate grid with new column
			update buttons with recheck duplication (don't assume duped work everytime) 
		*/

		const { posCol, posRow } = findIdPosition(grid, id)
		let col = grid.map((g) => g[posCol])
		let row = [...grid[posRow]]

		if (dir === 'col') {
			col = checkDuplicate(col, id) ? removeDuplicateIds(col) : fillArrayWithIds(col)
			grid.forEach((r, i) => (grid[i][posCol] = col[i])) // different /!\
		}

		if (dir === 'row') {
			row = checkDuplicate(row, id) ? removeDuplicateIds(row) : fillArrayWithIds(row)
			grid[posRow].forEach((r, i) => (grid[posRow][i] = row[i])) // different /!\
		}

		return grid
	}

	const gridWidget = {
		add: (grid: Layout['grid'], id: MoveKeys) => {
			// in triple colum, default colum is [x, here, x]
			const middleColumn = grid[0].length === 3 ? 1 : 0
			let index = 2

			// Quotes always at the bottom
			if (id === 'quotes') index = grid.length

			// Quick links above quotes, below the rest
			if (id === 'quicklinks') {
				const lastItemIsQuotes = grid[grid.length - 1][middleColumn] === 'quotes'
				index = lastItemIsQuotes ? grid.length - 1 : grid.length
			}

			// Create new row
			let newrow = grid[0].map(() => '.') // return [.] | [., .] | [., ., .] ????
			grid.splice(index, 0, newrow as any) // Todo: typeof JeComprendPasLa
			grid[index][middleColumn] = id

			return grid
		},

		remove: (grid: Layout['grid'], id: MoveKeys) => {
			// remove id from grid
			for (const i in grid) {
				for (const k in grid[i]) {
					if (grid[i][k] === id) grid[i][k] = '.'
				}
			}

			// if an empty row is found, removes it and quits
			let hasRemovedRow = false
			for (const ii in grid) {
				if (isRowEmpty(grid, parseInt(ii)) && !hasRemovedRow) {
					grid.splice(parseInt(ii), 1)
					hasRemovedRow = true
				}
			}

			return grid
		},
	}

	const gridOverlay = {
		add: (id: MoveKeys) => {
			const div = document.createElement('div')
			div.id = 'move-overlay-' + id
			div.className = 'move-overlay'
			dominterface?.appendChild(div)

			div.addEventListener('click', () => {
				updateMoveElement({ action: 'select', elementId: id })
			})
		},

		remove: (id: MoveKeys) => {
			document.querySelector('#move-overlay-' + id)?.remove()
		},

		removeAll: () => {
			document.querySelectorAll('.move-overlay').forEach((d) => d.remove())
		},
	}

	const buttonControl = {
		layout: (selection: Move['selection']) => {
			document.querySelectorAll<HTMLButtonElement>('#grid-layout button').forEach((b) => {
				clas(b, b.dataset.layout === selection, 'selected')
			})
		},

		grid: (id: MoveKeys) => {
			const grid = areaStringToLayoutGrid(dominterface?.style.getPropertyValue('--grid') || '')
			if (grid.length === 0) return

			let top = false,
				bottom = false,
				left = false,
				right = false

			// Detect if element is on array limits
			grid.forEach((row, i) => {
				if (row.some((a) => a === id) && i === 0) top = true
				if (row.some((a) => a === id) && i === grid.length - 1) bottom = true
				if (row.at(0) === id) left = true
				if (row.at(-1) === id) right = true
			})

			// link button to correct limit, apply disable attr
			document.querySelectorAll<HTMLButtonElement>('#grid-mover button').forEach((b) => {
				const c = parseInt(b.dataset.col || '0')
				const r = parseInt(b.dataset.row || '0')
				let limit = false

				if (r === -1) limit = top
				if (r === 1) limit = bottom
				if (c === -1) limit = left
				if (c === 1) limit = right

				limit ? b?.setAttribute('disabled', '') : b?.removeAttribute('disabled')
			})
		},

		span: (id: MoveKeys) => {
			function applyStates(dir: 'col' | 'row', state: boolean) {
				const dirButton = document.querySelector(`#grid-span-${dir}s`)
				const otherButton = document.querySelector(`#grid-span-${dir === 'col' ? 'rows' : 'cols'}`)

				if (state) otherButton?.setAttribute('disabled', '')
				else otherButton?.removeAttribute('disabled')

				clas(dirButton, state, 'selected')
			}

			const grid = areaStringToLayoutGrid(dominterface?.style.getPropertyValue('--grid') || '') as Layout['grid']
			if (grid.length === 0) return

			const { posCol, posRow } = findIdPosition(grid, id)
			let col = grid.map((g) => g[posCol])
			let row = [...grid[posRow]]

			applyStates('col', checkDuplicate(col, id))
			applyStates('row', checkDuplicate(row, id))
		},

		align: (item?: MoveItem) => {
			const boxBtns = document.querySelectorAll<HTMLButtonElement>('#box-alignment-mover button')
			const textBtns = document.querySelectorAll<HTMLButtonElement>('#text-alignment-mover button')

			boxBtns.forEach((b) => clas(b, b.dataset.align === item?.box, 'selected'))
			textBtns.forEach((b) => clas(b, b.dataset.align === item?.text, 'selected'))
		},

		reset: (move: Move) => {
			const btn = document.querySelector<HTMLButtonElement>('#reset-layout')
			const defaultGrid = syncDefaults.move.layouts[move.selection].grid
			const layout = move.layouts[move.selection]

			const isSameGrid = layoutToGridAreas(layout.grid) === layoutToGridAreas(defaultGrid)
			const isSameAlign = Object.values(layout.items).filter(({ box, text }) => box !== '' || text !== '').length === 0

			if (isSameGrid && isSameAlign) {
				btn?.setAttribute('disabled', '')
			} else {
				btn?.removeAttribute('disabled')
			}
		},
	}

	function removeSelection() {
		activeID = null
		buttonControl.align() // without params, selects 0 align

		document.querySelectorAll('.grid-spanner')?.forEach((elem) => {
			elem.removeAttribute('disabled')
			clas(elem, false, 'selected')
		})

		document.querySelectorAll<HTMLDivElement>('.move-overlay').forEach((elem) => {
			elem.classList.remove('selected')
		})

		document.querySelectorAll<HTMLButtonElement>('#grid-mover button').forEach((b) => {
			b.removeAttribute('disabled')
		})
	}

	//
	// Updates
	//

	type Update = {
		action:
			| 'toggle'
			| 'select'
			| 'widget'
			| 'grid'
			| 'span-cols'
			| 'span-rows'
			| 'box'
			| 'text'
			| 'layout'
			| 'reset'
			| 'responsive'
		button?: HTMLButtonElement
		elementId?: string
		ev?: KeyboardEvent
	}

	function updateMoveElement({ action, elementId, button }: Update) {
		storage.sync.get(['searchbar', 'notes', 'quotes', 'quicklinks', 'move'], (data) => {
			let move: Move

			// Check if storage has move, if not, use (/ deep clone) default move
			move = 'move' in data ? data.move : clonedeep(syncDefaults.move)

			// force single on small width
			if (smallWidth) {
				move.selection = 'single'
			}

			function gridChange() {
				if (!activeID || !button) return

				const { grid } = move.layouts[move.selection]

				// Get button move amount
				const y = parseInt(button.dataset.row || '0')
				const x = parseInt(button.dataset.col || '0')

				// Get current row / col
				const currR = grid.findIndex((row) => row.find((col) => col === activeID))
				const currC = grid[currR].findIndex((col) => col === activeID)

				// Update row / col
				const newR = clamp(currR + y, 0, grid.length - 1)
				const newC = clamp(currC + x, 0, grid[0].length - 1)

				// swap items
				let tempItem = grid[currR][currC]
				grid[currR][currC] = grid[newR][newC]
				grid[newR][newC] = tempItem

				// Apply changes
				setGridAreas(move.layouts[move.selection])
				move.layouts[move.selection].grid = grid

				buttonControl.grid(activeID)
				buttonControl.reset(move)

				storage.sync.set({ move: move })
			}

			function alignChange(type: 'box' | 'text') {
				if (!activeID || !button) return

				const layout = move.layouts[move.selection]
				const item = layout.items[activeID]

				item[type] = button.dataset.align || ''

				setAlign(item, activeID)
				buttonControl.align(item)
				buttonControl.reset(move)

				// Update storage
				move.layouts[move.selection].items[activeID] = item
				storage.sync.set({ move: move })
			}

			function layoutChange(selection?: Move['selection']) {
				if (!selection && button) {
					// button dataset is wrong somehow
					if (!((button.dataset.layout || 'triple') in move.layouts)) return
				}

				// Only update selection if coming from user
				if (action !== 'responsive' && button) {
					move.selection = (button.dataset.layout || 'triple') as Move['selection']
					storage.sync.set({ move: move })
				}

				// Assign layout after mutating move
				const layout = move.layouts[move.selection]

				setAllAligns(layout.items)
				setGridAreas(layout)
				buttonControl.reset(move)
				buttonControl.layout(move.selection)

				if (activeID) {
					buttonControl.grid(activeID)
					buttonControl.align(layout.items[activeID])
				}
			}

			function layoutReset() {
				function addEnabledWidgetsToGrid(grid: Layout['grid']) {
					// Filters "on" widgets, adds all widgets to grid
					// remove quicklinks here bc its in reset data already
					const enabledWidgets = getEnabledWidgetsFromStorage(data as Sync).filter((a) => a !== 'quicklinks')

					enabledWidgets.forEach((id) => {
						grid = gridWidget.add(grid, id)
					})

					return grid
				}

				// DEEP CLONE is important as to not mutate sync defaults (it shouldn't come to this, but here we are)
				// Destructure layout to appease typescript
				Object.entries(clonedeep(syncDefaults.move.layouts)).forEach(([key, layout]) => {
					const selection = key as Move['selection']
					const { grid, items } = layout

					move.layouts[selection].grid = addEnabledWidgetsToGrid(grid)
					move.layouts[selection].items = items
				})

				// Assign layout after mutating move
				const layout = move.layouts[move.selection]

				setAllAligns(layout.items)
				setGridAreas(layout)
				buttonControl.reset(move)
				removeSelection()

				// Save
				storage.sync.set({ move: move })
			}

			function elementSelection() {
				const layout = move.layouts[move.selection]

				removeSelection()

				// Only remove selection modifiers if failed to get id
				if (!isEditing() || !elementId || !(elementId in layout.items)) {
					return
				}

				const id = elementId as MoveKeys

				buttonControl.align(layout.items[id])
				buttonControl.span(id)
				buttonControl.grid(id)

				document.querySelector('#move-overlay-' + id)!.classList.add('selected') // add clicked
				activeID = id
			}

			function toggleMoveStatus(e?: KeyboardEvent) {
				const toggle = () => {
					if (dominterface?.classList.contains('move-edit')) {
						gridOverlay.removeAll()
					} else {
						const ids = getEnabledWidgetsFromStorage(data as Sync).concat(['main', 'time'])
						ids.forEach((id) => gridOverlay.add(id))
					}

					dominterface?.classList.toggle('move-edit')
					removeSelection()
				}

				e ? (e.key === 'm' ? toggle() : '') : toggle()
			}

			function toggleGridSpans(dir: 'col' | 'row') {
				if (!activeID) return

				const layout = move.layouts[move.selection]
				layout.grid = spansInGridArea(dir, layout.grid, activeID)

				setGridAreas(layout)
				buttonControl.grid(activeID)
				buttonControl.span(activeID)

				storage.sync.set({ move: move })
			}

			function addOrRemmoveWidgets() {
				if (!widget) return

				const { id, on } = widget

				// For all layouts
				Object.entries(move.layouts).forEach(([key, layout]) => {
					const selection = key as Move['selection']
					move.layouts[selection].grid = on ? gridWidget.add(layout.grid, id) : gridWidget.remove(layout.grid, id)
				})

				removeSelection()
				setGridAreas(move.layouts[move.selection])
				setAllAligns(move.layouts[move.selection].items)

				// add/remove widget overlay only when editing move
				if (isEditing()) {
					on ? gridOverlay.add(id) : gridOverlay.remove(id)
				}

				storage.sync.set({ move: move }, () => {
					setTimeout(() => {
						sessionStorage.throttledWidgetInput = '' // initParams events in settings.ts
					}, 256) // increase throttle time for dramatic purposes
				})
			}

			switch (action) {
				case 'toggle':
					toggleMoveStatus()
					break

				case 'select':
					elementSelection()
					break

				case 'grid':
					gridChange()
					break

				case 'span-cols':
					toggleGridSpans('col')
					break

				case 'span-rows':
					toggleGridSpans('row')
					break

				case 'box':
					alignChange('box')
					break

				case 'text':
					alignChange('text')
					break

				case 'layout':
					layoutChange()
					break

				case 'reset':
					layoutReset()

				case 'responsive':
					layoutChange()
					break

				case 'widget':
					addOrRemmoveWidgets()
					break
			}
		})
	}

	if (widget) {
		updateMoveElement({ action: 'widget' })
	}

	if (init) {
		//
		// Init
		//

		;(function initilisation() {
			// Detect small width on startup
			if (window.innerWidth < 764) {
				init.selection = 'single'
			}

			const layout = init.layouts[init.selection]

			setAllAligns(layout.items)
			setGridAreas(layout)
			buttonControl.layout(init.selection)
		})()

		//
		// Events
		//

		setTimeout(() => {
			document.addEventListener('keypress', (ev: KeyboardEvent) => updateMoveElement({ action: 'toggle', ev: ev }))

			Object.entries(elements).forEach(([key, elem]) => {
				elem?.addEventListener('click', () => updateMoveElement({ action: 'select', elementId: key }))
			})

			document.querySelectorAll<HTMLButtonElement>('#grid-layout button').forEach((button) => {
				button.addEventListener('click', () => updateMoveElement({ action: 'layout', button }))
			})

			document.querySelectorAll<HTMLButtonElement>('#grid-mover button').forEach((button) => {
				button.addEventListener('click', () => updateMoveElement({ action: 'grid', button }))
			})

			document.querySelectorAll<HTMLButtonElement>('#box-alignment-mover button').forEach((button) => {
				button.addEventListener('click', () => updateMoveElement({ action: 'box', button }))
			})

			document.querySelectorAll<HTMLButtonElement>('#text-alignment-mover button').forEach((button) => {
				button.addEventListener('click', () => updateMoveElement({ action: 'text', button }))
			})

			document.querySelector<HTMLButtonElement>('#reset-layout')?.addEventListener('click', () => {
				updateMoveElement({ action: 'reset' })
			})

			document
				.querySelector<HTMLButtonElement>('#close-mover')
				?.addEventListener('click', () => updateMoveElement({ action: 'toggle' }))

			document.querySelector<HTMLButtonElement>('#grid-span-cols')?.addEventListener('click', () => {
				updateMoveElement({ action: 'span-cols' })
			})

			document.querySelector<HTMLButtonElement>('#grid-span-rows')?.addEventListener('click', () => {
				updateMoveElement({ action: 'span-rows' })
			})

			// Trigger a layout change when width is crosses threshold
			window.addEventListener('resize', () => {
				if (window.innerWidth < 764 && !smallWidth) smallWidth = true
				if (window.innerWidth > 764 && smallWidth) smallWidth = false

				updateMoveElement({ action: 'responsive' })
			})
		}, 200)
	}
}
