<script lang="ts">
	import { DragScope, preventNativeDrag, type Drag as PointerDrag } from '$lib/ui/drag';
	import { onDestroy } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { trimEdge } from '$lib/model/edits';
	import { formatClock, formatShort } from '$lib/model/time';
	import { sceneDuration } from '$lib/model/timeline';
	import type { Scene } from '$lib/model/types';
	import { useEditor } from '$lib/state/context';
	import SceneCard from './SceneCard.svelte';
	import TransitionButton from './TransitionButton.svelte';
	import TransitionPicker from './TransitionPicker.svelte';
	import TrackLane from './TrackLane.svelte';
	import TrackHeader from './TrackHeader.svelte';
	import KeyframeMarkers from './KeyframeMarkers.svelte';
	import { Snapper, toFrame } from './snap';
	import { frameBatch } from '$lib/ui/frameBatch';
	import VolumeLine from './VolumeLine.svelte';
	import type { DropTarget, LaneServices } from './lanes';
	import { accepts, type ItemKind } from '$lib/model/tracks';
	import { allItems, itemKind } from '$lib/model/items';
	import { formatRatio } from '$lib/model/format';
	import { dragHasVisual, handleVisualDrop } from '$lib/media/dragTypes';
	import Maximize from '@lucide/svelte/icons/maximize-2';
	import MoveHorizontal from '@lucide/svelte/icons/move-horizontal';
	import ArrowRightToLine from '@lucide/svelte/icons/arrow-right-to-line';
	import ArrowLeftToLine from '@lucide/svelte/icons/arrow-left-to-line';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Copy from '@lucide/svelte/icons/copy';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { ConfirmDialog, Menu, type MenuItem } from '$lib/ui';
	import type { Track } from '$lib/model/tracks';
	import { RULER_H, trackHeight } from './layout';
	import { tick } from 'svelte';
	import { fitTimeline, mapTicks, MIN_ITEM_PX, ppsToZoom, timeMap, zoomToPps } from './scale';

	interface Props {
		onaddscene?: () => void;
		/** The storyboard's height (set with the divider above it). */
		height?: number;
	}

	let { onaddscene, height }: Props = $props();

	const editor = useEditor();

	const CARD_GAP = 10;
	/** Height of a scene card's picture (the card is 104 px with its name below). */
	const CARD_PICTURE_H = 70;
	/** Width of the track headers on the left (matches --track-header-w). */
	const HEADER_W = 172;
	const ADD_CARD_W = 104;
	const LOADING_CARD_W = 120;
	const END_PAD = 24;
	/** Matches the right padding of `.tracks`. */
	const TRACK_PAD = 24;
	/** Pointer travel before a press on a card turns into a drag. */
	const DRAG_THRESHOLD = 5;

	let trackWidth = $state(0);
	let tracks: HTMLDivElement;

	const scenes = $derived(editor.project.scenes);
	const duration = $derived(editor.duration);
	const importing = $derived(editor.importing);

	// ─── Gestures ───────────────────────────────────────────────────────────────────────────
	/** Every drag ends on release, cancel, lost capture or a move with no button (see drag.ts). */
	const drags = new DragScope();
	onDestroy(() => drags.dispose());
	interface Drag {
		id: string;
		from: number;
		to: number;
		pointerId: number;
		startX: number;
		/** Pointer position inside the card when grabbed. */
		grab: number;
		/** Card's left edge in content pixels while dragging. */
		x: number;
		active: boolean;
		startY: number;
		/** The tracks' scroll when the drag began. */
		startScroll: number;
		/** Dragged up onto an overlay track (or a gap): where it would become an overlay (else null). */
		toLayers: { start: number; duration: number; target: DropTarget } | null;
		dy: number;
	}
	interface Trim {
		id: string;
		edge: 'start' | 'end';
		startX: number;
		delta: number;
	}

	let drag = $state<Drag | null>(null);
	/** The transition picker that is open: which scene it follows, and where to show it. */
	let picker = $state<{ sceneId: string; after: number; x: number; y: number } | null>(null);

	function openPicker(event: MouseEvent, item: Item) {
		if (picker?.sceneId === item.scene.id) {
			picker = null;
			return;
		}
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		picker = {
			sceneId: item.scene.id,
			after: item.index + 1,
			x: rect.left + rect.width / 2,
			y: rect.top
		};
	}

	const pickerScene = $derived(picker ? scenes.find((s) => s.id === picker!.sceneId) : null);
	let trim = $state<Trim | null>(null);
	/** The scale is frozen during a gesture so the storyboard doesn't rescale under the pointer. */
	let frozenPps = $state<number | null>(null);

	const durations = $derived(scenes.map(sceneDuration));
	/** The scale that shows the whole video ("Fit"). */
	const fittedPps = $derived(
		fitTimeline(durations, trackWidth - HEADER_W - TRACK_PAD - ADD_CARD_W - END_PAD - CARD_GAP)
	);
	/** Zoom slider, 0 = Fit, 1 = closest. */
	let zoom = $state(0);
	const pps = $derived(frozenPps ?? zoomToPps(zoom, fittedPps));
	/** Where times sit on the storyboard (short scenes get a minimum width, see TimeMap). */
	const map = $derived(timeMap(durations, pps));
	/** A scene card's width. */
	const segW = (s: Scene) => Math.max(MIN_ITEM_PX, sceneDuration(s) * pps);

	/** Zoom so that the time under `clientX` stays under the pointer. */
	let anchor: { t: number; x: number; from: 'wheel' | 'slider' } | null = null;
	let zooming = $state(false);
	let zoomingTimer: ReturnType<typeof setTimeout> | undefined;
	function zoomAround(value: number, clientX?: number) {
		// Positions within the visible part of the lanes (right of the track headers).
		const rect = tracks.getBoundingClientRect();
		const view = rect.width - HEADER_W;
		const playheadX = map.x(editor.time) - tracks.scrollLeft;
		const anchorX =
			clientX !== undefined
				? clientX - rect.left - HEADER_W
				: playheadX >= 0 && playheadX <= view
					? playheadX
					: view / 2;
		// A burst of wheel events (or slider moves) keeps its first anchor until the zooming stops,
		// so each step doesn't drift by the scroll the previous one hasn't applied yet.
		const from = clientX === undefined ? 'slider' : 'wheel';
		if (!anchor || anchor.from !== from || (from === 'wheel' && Math.abs(anchor.x - anchorX) > 2)) {
			anchor = { t: map.t(tracks.scrollLeft + anchorX), x: anchorX, from };
		}
		// No card animations while zooming, so everything scales together.
		zooming = true;
		clearTimeout(zoomingTimer);
		zoomingTimer = setTimeout(() => {
			zooming = false;
			anchor = null;
		}, 200);
		zoom = Math.min(1, Math.max(0, value));
	}

	// After each zoom step is on screen, scroll so the anchor time is back under the pointer.
	$effect(() => {
		const m = map;
		if (anchor && zooming) tracks.scrollLeft = Math.max(0, m.x(anchor.t) - anchor.x);
	});

	function fit() {
		anchor = null;
		zooming = false;
		zoom = 0;
		tracks.scrollLeft = 0;
	}

	// Ctrl/Cmd + scroll zooms around the pointer (a non-passive listener, to stop page zoom).
	$effect(() => {
		const el = tracks;
		const onwheel = (event: WheelEvent) => {
			// Shift + wheel scrolls sideways (a plain wheel scrolls the tracks up and down).
			if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
				if (event.deltaX !== 0 || event.deltaY === 0) return;
				event.preventDefault();
				el.scrollLeft += event.deltaY;
				return;
			}
			if (!event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			const current = ppsToZoom(pps, fittedPps);
			void zoomAround(current - event.deltaY * 0.0025, event.clientX);
		};
		el.addEventListener('wheel', onwheel, { passive: false });
		return () => el.removeEventListener('wheel', onwheel);
	});

	interface Item {
		scene: Scene;
		index: number;
		left: number;
		width: number;
		duration: number;
	}

	const layout = $derived.by(() => {
		let order = scenes.map((scene, index) => ({ scene, index }));
		if (drag?.active) {
			const d = drag;
			const moving = order.find((o) => o.scene.id === d.id)!;
			order = order.filter((o) => o.scene.id !== d.id);
			order.splice(d.to, 0, moving);
		}
		let x = 0;
		const items: Item[] = [];
		for (const { scene, index } of order) {
			const dur = sceneDuration(scene);
			const w = segW(scene);
			if (trim && trim.id === scene.id) {
				const trimmed = sceneDuration(trimEdge(scene, trim.edge, trim.delta, editor.bounds(scene)));
				const tw = Math.max(MIN_ITEM_PX, trimmed * pps);
				if (trim.edge === 'end') {
					items.push({ scene, index, left: x, width: tw, duration: trimmed });
					x += tw;
				} else {
					// The left edge follows the pointer; later cards move once the trim is done.
					items.push({ scene, index, left: x + w - tw, width: tw, duration: trimmed });
					x += w;
				}
			} else {
				items.push({ scene, index, left: x, width: w, duration: dur });
				x += w;
			}
		}
		return { items, end: x };
	});

	let rulerLane: HTMLDivElement;
	let scenesRow = $state<HTMLDivElement>();
	/** Where a drag has snapped to (content x), and where a dragged item would land. */
	let snapX = $state<number | null>(null);
	let dropTarget = $state<{ target: DropTarget; from: string } | null>(null);

	const trackList = $derived(editor.project.tracks);
	const mainIndex = $derived(trackList.findIndex((t) => t.kind === 'main'));

	/**
	 * What's under a pointer's y for a dragged item of `kind`: a track it can go on, the gap
	 * between two tracks (or above the top one / below the bottom one) where a new track would be
	 * made, or the Scenes track (pictures only). Null: nowhere new.
	 */
	function targetAt(clientY: number, kind: ItemKind, clientX?: number): DropTarget | null {
		const rows = [...tracks.querySelectorAll<HTMLElement>('[data-track-row]')];
		const rects = rows.map((r) => r.getBoundingClientRect());
		const EDGE = 4;
		// Gap i is the space before row i (i = 0: above the top track; i = n: below the last),
		// reaching a few pixels into the rows on either side.
		for (let i = 0; i <= rects.length; i++) {
			const top = i > 0 ? rects[i - 1].bottom - EDGE : -Infinity;
			const bottom = i < rects.length ? rects[i].top + EDGE : Infinity;
			if (clientY < top || clientY >= bottom) continue;
			// Only where that kind of track may go: overlay tracks above the Scenes track, audio below.
			if (kind === 'sound' ? i > mainIndex : i <= mainIndex) return { kind: 'gap', index: i };
			break;
		}
		const i = rects.findIndex((r) => clientY >= r.top && clientY < r.bottom);
		if (i === -1) return null;
		const track = trackList[i];
		if (!track) return null;
		if (track.kind === 'main') {
			return kind === 'overlay' && clientX !== undefined
				? { kind: 'main', index: insertIndexAt(contentX(clientX)) }
				: null;
		}
		return accepts(track, kind) && !track.locked ? { kind: 'track', id: track.id } : null;
	}

	// ─── Height, scrolling ──────────────────────────────────────────────────────────────────
	/** How far the tracks are scrolled sideways (the playhead hides under the headers). */
	let scrollLeft = $state(0);
	/** Every item's track and kind, for the tracks' heights. */
	const itemKinds = $derived(
		allItems(editor.project).map((i) => ({ trackId: i.trackId, kind: i.kind }))
	);

	/** Auto-scroll while dragging near the top or bottom edge of the tracks. */
	const EDGE = 36;
	const MAX_SPEED = 16;
	let autoY: number | null = null;
	let autoFrame = 0;
	let onAutoScroll: (() => void) | undefined;
	function autoScroll(clientY: number | null, onscroll?: () => void) {
		autoY = clientY;
		onAutoScroll = onscroll;
		if (clientY === null) {
			cancelAnimationFrame(autoFrame);
			autoFrame = 0;
		} else if (!autoFrame) autoFrame = requestAnimationFrame(autoStep);
	}
	function autoStep() {
		autoFrame = 0;
		if (autoY === null || !tracks) return;
		const r = tracks.getBoundingClientRect();
		const top = r.top + RULER_H;
		let v = 0;
		if (autoY < top + EDGE) v = -Math.min(1, (top + EDGE - autoY) / EDGE) * MAX_SPEED;
		else if (autoY > r.bottom - EDGE)
			v = Math.min(1, (autoY - (r.bottom - EDGE)) / EDGE) * MAX_SPEED;
		if (v === 0) return;
		const before = tracks.scrollTop;
		tracks.scrollTop = before + Math.round(v);
		if (tracks.scrollTop !== before) onAutoScroll?.();
		// (The callback may have asked for the next step already.)
		if (!autoFrame && autoY !== null) autoFrame = requestAnimationFrame(autoStep);
	}
	onDestroy(() => cancelAnimationFrame(autoFrame));

	// A new track scrolls into view.
	let knownTracks: Set<string> | null = null;
	$effect(() => {
		const ids = trackList.map((t) => t.id);
		const known = knownTracks;
		knownTracks = new Set(ids);
		const added = known ? ids.filter((id) => !known.has(id)) : [];
		if (added.length !== 1) return;
		void tick().then(() => {
			const row = tracks?.querySelector<HTMLElement>(
				`[data-track-row][data-track-id="${added[0]}"]`
			);
			if (!row) return;
			// Below the sticky ruler if it's above it.
			const r = row.getBoundingClientRect();
			const view = tracks.getBoundingClientRect();
			if (r.top < view.top + RULER_H) tracks.scrollTop -= view.top + RULER_H - r.top + 4;
			else if (r.bottom > view.bottom) tracks.scrollTop += r.bottom - view.bottom + 4;
		});
	});

	const services: LaneServices = {
		targetAt: (clientY, kind, clientX) => targetAt(clientY, kind, clientX),
		showTarget: (target, from) => {
			dropTarget = target ? { target, from } : null;
			dropIndex = target?.kind === 'main' ? target.index : null;
		},
		snapTargets: (except) => {
			const list = [0, duration, editor.time];
			for (const p of editor.placed) list.push(p.start, p.end);
			for (const i of allItems(editor.project))
				if (!except.includes(i.id)) list.push(i.start, i.start + i.duration);
			return list;
		},
		setSnap: (x) => (snapX = x),
		autoScroll,
		scrollTop: () => tracks?.scrollTop ?? 0
	};

	// ─── Track headers: menu, rename, delete, move ─────────────────────────────────────────
	let trackMenu = $state<{ track: Track; anchor: HTMLElement } | null>(null);
	let renamingId = $state<string | null>(null);
	let deletingTrack = $state<Track | null>(null);
	/** A track being dragged by its header, and the gap (index in the list) it would go to. */
	let reorder = $state<{ id: string; index: number } | null>(null);
	/** A selection box being drawn (in the track list's content coordinates). */
	let band = $state<{ left: number; top: number; width: number; height: number } | null>(null);
	let grid: HTMLDivElement;

	/** The menu's items, for the track it was opened on (it closes before an item runs). */
	function trackMenuItems(t: Track): MenuItem[] {
		return [
			{ label: 'Rename', icon: Pencil, onselect: () => (renamingId = t.id) },
			{ label: 'Duplicate track', icon: Copy, onselect: () => editor.duplicateTrack(t.id) },
			{
				label: 'Delete track',
				icon: Trash2,
				separator: true,
				onselect: () => {
					if (editor.itemsOnTrack(t.id)) deletingTrack = t;
					else editor.deleteTrack(t.id);
				}
			}
		];
	}

	/** The gap a dragged track header is over, kept where that kind of track may go. */
	function reorderIndexAt(clientY: number, track: Track): number {
		const rows = [...tracks.querySelectorAll<HTMLElement>('[data-track-row]')];
		let index = rows.filter((r) => {
			const b = r.getBoundingClientRect();
			return b.top + b.height / 2 < clientY;
		}).length;
		if (track.kind === 'overlay') index = Math.min(index, mainIndex);
		else index = Math.max(index, mainIndex + 1);
		return index;
	}

	function onHeaderPointerDown(event: PointerEvent, track: Track) {
		if (event.button !== 0 || track.kind === 'main') return;
		const y0 = event.clientY;
		const from = trackList.findIndex((t) => t.id === track.id);
		let active = false;
		const handle = drags.start(
			event,
			{
				move: (e) => {
					if (!active && Math.abs(e.clientY - y0) < DRAG_THRESHOLD) return;
					if (!active) handle.capture(tracks);
					active = true;
					reorder = { id: track.id, index: reorderIndexAt(e.clientY, track) };
					autoScroll(e.clientY, () => {
						if (reorder) reorder = { id: track.id, index: reorderIndexAt(e.clientY, track) };
					});
				},
				end: (_e, cancelled) => {
					autoScroll(null);
					const r = reorder;
					reorder = null;
					if (!active || cancelled || !r) return;
					// The index among the other tracks (this one taken out).
					editor.moveTrack(track.id, r.index > from ? r.index - 1 : r.index);
				}
			},
			null
		);
	}

	const loadingWidth = $derived(importing * (LOADING_CARD_W + CARD_GAP));
	const contentWidth = $derived(
		Math.max(layout.end, map.x(duration)) + loadingWidth + CARD_GAP + ADD_CARD_W
	);
	const rulerTicks = $derived(mapTicks(map, duration));

	function thumbnailFor(scene: Scene): string {
		const url = editor.thumbnails[scene.mediaId];
		return url ? `url("${url}")` : 'none';
	}

	/**
	 * Drag an edge of the range on the ruler: snapping to the playhead and scene edges (Alt: no
	 * snapping). One undo step.
	 */
	function onRangeEdgeDown(event: PointerEvent, edge: 'start' | 'end') {
		if (event.button !== 0 || !editor.project.range) return;
		event.preventDefault();
		event.stopPropagation();
		editor.beginGesture();
		const snapper = new Snapper();
		const batch = frameBatch((e: PointerEvent) => {
			const r = editor.project.range;
			if (!r) return;
			let t = toFrame(map.t(Math.max(0, contentX(e.clientX))), editor.project.format.fps);
			const targets = e.altKey
				? []
				: [editor.time, 0, duration, ...editor.placed.flatMap((p) => [p.start, p.end])];
			t += snapper.snap([t], targets, map.x, e.altKey).shift;
			const min = 1 / 30;
			const next =
				edge === 'start'
					? { start: Math.max(0, Math.min(t, r.end - min)), end: r.end }
					: { start: r.start, end: Math.min(duration, Math.max(t, r.start + min)) };
			editor.live((p) => {
				p.range = next;
			});
		});
		drags.start(event, {
			move: (e) => batch.push(e),
			end: () => {
				batch.flush();
				editor.endGesture('Range');
			}
		});
	}

	let rangeMenu = $state(false);
	let rangeMenuButton = $state<HTMLButtonElement>();
	const rangeMenuItems = $derived<MenuItem[]>([
		{
			label: 'Set range to selection',
			disabled: !editor.selectedIds.length,
			onselect: () => editor.setRangeToSelection()
		},
		{
			label: 'Clear range',
			shortcut: 'Alt+X',
			disabled: !editor.project.range,
			onselect: () => editor.clearRange()
		}
	]);

	/** A pointer's x on the timeline (content pixels): measured from the lanes' left edge. */
	function contentX(clientX: number): number {
		return clientX - rulerLane.getBoundingClientRect().left;
	}

	// Reorder by dragging a card.
	function onCardPointerDown(event: PointerEvent, item: Item) {
		if (event.button !== 0 || trim) return;
		drag = {
			id: item.scene.id,
			from: item.index,
			to: item.index,
			pointerId: event.pointerId,
			startX: event.clientX,
			grab: contentX(event.clientX) - item.left,
			x: item.left,
			active: false,
			startY: event.clientY,
			startScroll: tracks.scrollTop,
			toLayers: null,
			dy: 0
		};
		// Nothing is captured yet, so a plain click still selects the card.
		const batch = frameBatch(onCardPointerMove);
		cardDrag = drags.start(
			event,
			{
				move: (e) => batch.push(e),
				end: () => {
					batch.flush();
					onCardDragEnd();
				}
			},
			null
		);
	}

	let cardDrag: PointerDrag | null = null;

	function onCardPointerMove(event: PointerEvent) {
		const d = drag;
		if (!d || event.pointerId !== d.pointerId) return;
		if (!d.active) {
			if (Math.hypot(event.clientX - d.startX, event.clientY - d.startY) < DRAG_THRESHOLD) return;
			d.active = true;
			frozenPps = pps;
			// Captured by the tracks, which stay put: the card's own element is moved around the
			// page as the order changes, which would lose the capture.
			cardDrag?.capture(tracks);
		}
		autoScrollX(event.clientX);
		autoScroll(event.clientY, () => onCardPointerMove(event));
		const x = contentX(event.clientX);
		d.x = x - d.grab;
		// The card follows the pointer, also when the tracks scroll under it.
		d.dy = event.clientY - d.startY + tracks.scrollTop - d.startScroll;
		// Up onto an overlay track (or into a gap above the Scenes track): it would become an
		// overlay there (the scenes don't reorder meanwhile).
		const up = event.clientY < scenesRow!.getBoundingClientRect().top - 2;
		const target = up ? targetAt(event.clientY, 'overlay') : null;
		if (target && target.kind !== 'main') {
			const scene = scenes.find((s) => s.id === d.id)!;
			d.toLayers = {
				start: Math.max(0, map.t(Math.max(0, d.x))),
				duration:
					scene.kind === 'video' ? scene.sourceEnd - scene.sourceStart : sceneDuration(scene),
				target
			};
			dropTarget = { target, from: 'main' };
			d.to = d.from;
			return;
		}
		d.toLayers = null;
		dropTarget = null;
		// Insert before the first other card whose middle is right of the pointer.
		let offset = 0;
		let to = 0;
		for (const s of scenes) {
			if (s.id === d.id) continue;
			const w = segW(s);
			if (offset + w / 2 < x) to++;
			offset += w;
		}
		d.to = to;
	}

	function onCardDragEnd() {
		cardDrag = null;
		autoScroll(null);
		const d = drag;
		if (!d) return;
		drag = null;
		frozenPps = null;
		if (d.active) {
			// The click that ends a drag must not also select; later clicks must still work.
			suppressClick = true;
			setTimeout(() => (suppressClick = false));
			const to = d.toLayers;
			dropTarget = null;
			if (to?.target.kind === 'track') editor.sceneToOverlay(d.id, to.start, to.target.id);
			else if (to?.target.kind === 'gap')
				editor.sceneToOverlay(d.id, to.start, undefined, to.target.index);
			else editor.moveScene(d.from, d.to);
		}
	}

	// Dropping something from "Your media" onto the scenes row.
	let dropIndex = $state<number | null>(null);

	function insertIndexAt(x: number): number {
		let offset = 0;
		let index = 0;
		for (const s of scenes) {
			const w = segW(s);
			if (offset + w / 2 < x) index++;
			offset += w;
		}
		return index;
	}

	/** Pixel position of the gap before scene `index`. */
	function gapX(index: number): number {
		return scenes.slice(0, index).reduce((x, s) => x + segW(s), 0);
	}

	function onMediaDragOver(event: DragEvent) {
		if (!dragHasVisual(event)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		dropIndex = insertIndexAt(contentX(event.clientX));
	}

	function onMediaDrop(event: DragEvent) {
		if (!dragHasVisual(event)) return;
		const index = insertIndexAt(contentX(event.clientX));
		dropIndex = null;
		const placed = handleVisualDrop(event, {
			media: (id) => editor.addSceneFromMedia(id, index),
			card: () => editor.addCard(index),
			files: (files) => void editor.importFiles(files, index)
		});
		if (placed) event.preventDefault();
	}

	// Dropping from "Your media", the Cards button or the computer onto an overlay track: an overlay
	// at that time on that track (a new track just above if it would overlap).
	let laneDrop = $state<{ trackId: string; start: number } | null>(null);
	const dropTime = (clientX: number) =>
		Math.max(0, Math.min(map.t(contentX(clientX)), Math.max(0, duration - 0.5)));

	function onLaneDragOver(event: DragEvent, trackId: string) {
		const track = editor.track(trackId);
		if (!dragHasVisual(event) || track?.kind !== 'overlay' || track.locked) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		laneDrop = { trackId, start: dropTime(event.clientX) };
	}

	function onLaneDrop(event: DragEvent, trackId: string) {
		const track = editor.track(trackId);
		if (!dragHasVisual(event) || track?.kind !== 'overlay' || track.locked) return;
		const start = dropTime(event.clientX);
		laneDrop = null;
		const noScenes = scenes.length === 0;
		const placed = handleVisualDrop(event, {
			media: (id) =>
				noScenes ? editor.addSceneFromMedia(id) : editor.addOverlayFromMedia(id, start, trackId),
			card: () => (noScenes ? editor.addCard() : editor.addCardOverlay(start, trackId)),
			files: (files) => void editor.importAsOverlays(files, start, trackId)
		});
		if (placed) event.preventDefault();
	}

	let suppressClick = false;
	function onCardClick(id: string) {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		editor.select(id);
	}

	function onCardKeydown(event: KeyboardEvent, item: Item) {
		if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
		event.preventDefault();
		const to = item.index + (event.key === 'ArrowLeft' ? -1 : 1);
		if (to < 0 || to >= scenes.length) return;
		editor.moveScene(item.index, to);
		// Keep focus on the moved card.
		requestAnimationFrame(() =>
			tracks.querySelector<HTMLElement>(`[data-scene-id="${item.scene.id}"] .card`)?.focus()
		);
	}

	function autoScrollX(clientX: number) {
		const rect = tracks.getBoundingClientRect();
		const edge = 48;
		if (clientX < rect.left + edge) tracks.scrollLeft -= 12;
		else if (clientX > rect.right - edge) tracks.scrollLeft += 12;
	}

	// Trim by dragging a card edge.
	function onTrimPointerDown(event: PointerEvent, item: Item, edge: 'start' | 'end') {
		if (event.button !== 0) return;
		event.stopPropagation();
		event.preventDefault();
		frozenPps = pps;
		trim = { id: item.scene.id, edge, startX: event.clientX, delta: 0 };
		// Once per animation frame (the latest move); the scene changes once, at the end.
		const batch = frameBatch((e: PointerEvent) => onTrimPointerMove(e, item));
		drags.start(event, {
			move: (e) => batch.push(e),
			end: () => {
				batch.flush();
				onTrimPointerUp();
			}
		});
		if (editor.selectedId !== item.scene.id) editor.selectedId = item.scene.id;
		peekTrim(item.scene);
	}

	function onTrimPointerMove(event: PointerEvent, item: Item) {
		if (!trim || trim.id !== item.scene.id) return;
		// Whole frames of the video.
		trim.delta = toFrame((event.clientX - trim.startX) / pps, editor.project.format.fps);
		peekTrim(item.scene);
	}

	function onTrimPointerUp() {
		const t = trim;
		if (!t) return;
		trim = null;
		frozenPps = null;
		editor.player.endPeek();
		editor.trimScene(t.id, t.edge, t.delta);
	}

	/** Show the frame at the edge being trimmed. */
	function peekTrim(scene: Scene) {
		if (!trim || scene.kind !== 'video') return;
		const trimmed = trimEdge(scene, trim.edge, trim.delta, editor.bounds(scene));
		editor.player.peek(
			scene.id,
			trim.edge === 'start' ? trimmed.sourceStart : trimmed.sourceEnd - 1 / 30
		);
	}

	// Playhead
	function timeFromPointer(event: PointerEvent): number {
		return Math.min(duration, Math.max(0, map.t(contentX(event.clientX))));
	}

	function onRulerDown(event: PointerEvent) {
		if (event.button !== 0) return;
		editor.seek(timeFromPointer(event));
		drags.start(event, { move: (e) => editor.seek(timeFromPointer(e)), end: () => {} });
	}

	function onPlayheadKey(event: KeyboardEvent) {
		const step = event.shiftKey ? 1 : 1 / 30;
		if (event.key === 'ArrowLeft') editor.nudge(-step);
		else if (event.key === 'ArrowRight') editor.nudge(step);
		else if (event.key === 'Home') editor.seek(0);
		else if (event.key === 'End') editor.seek(duration);
		else return;
		event.preventDefault();
	}

	/**
	 * Clicking empty space in the storyboard (between or after the scenes, or in the Words and
	 * Sound lanes) deselects everything; the settings show the scene under the playhead.
	 */
	function onEmptyPointerDown(event: PointerEvent) {
		if (event.button !== 0 || editor.cropping) return;
		const target = event.target as Element;
		const onItem = target.closest(
			'button, input, .zoom, [role="button"], .card-slot, .item-slot, .track-header, .ruler, .playhead, .transition-slot, .loading-card, [role="dialog"], [role="menu"]'
		);
		if (onItem) return;
		const lane = target.closest<HTMLElement>('[data-track-lane]');
		if (lane) editor.activeTrackId = lane.dataset.trackLane ?? null;
		// Shift adds to what's selected; otherwise start afresh.
		const kept = event.shiftKey
			? editor.selectedIds.filter((id) => itemKind(editor.project, id))
			: [];
		if (!event.shiftKey) editor.deselect();
		if (!target.closest('.tracks')) return;
		// Dragging from an empty spot draws a selection box.
		const g0 = grid.getBoundingClientRect();
		const from = { x: event.clientX - g0.left, y: event.clientY - g0.top };
		drags.start(
			event,
			{
				move: function move(e) {
					const g = grid.getBoundingClientRect();
					const to = { x: e.clientX - g.left, y: e.clientY - g.top };
					if (!band && Math.hypot(to.x - from.x, to.y - from.y) < 4) return;
					autoScroll(e.clientY, () => move(e));
					band = {
						left: Math.min(from.x, to.x),
						top: Math.min(from.y, to.y),
						width: Math.abs(to.x - from.x),
						height: Math.abs(to.y - from.y)
					};
					const box = {
						left: g.left + band.left,
						top: g.top + band.top,
						right: g.left + band.left + band.width,
						bottom: g.top + band.top + band.height
					};
					const hit = [...tracks.querySelectorAll<HTMLElement>('.item-slot[data-item-id]')]
						.filter((el) => {
							const r = el.getBoundingClientRect();
							return (
								r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top
							);
						})
						.map((el) => el.dataset.itemId!);
					// Keyframe markers inside the box: those keyframes (rather than whole items).
					const marks = [...tracks.querySelectorAll<HTMLElement>('.kf[data-keyframe]')]
						.filter((el) => {
							const r = el.getBoundingClientRect();
							return (
								r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top
							);
						})
						.map((el) => ({ itemId: el.dataset.keyframeItem!, id: el.dataset.keyframe! }));
					if (marks.length) {
						const owners = [...new Set(marks.map((m) => m.itemId))];
						if (owners.length === 1 && editor.selectedId !== owners[0]) editor.select(owners[0]);
						editor.selectKeyframes(marks);
						return;
					}
					editor.selectItems([...kept, ...hit.filter((id) => !kept.includes(id))]);
				},
				end: () => {
					autoScroll(null);
					band = null;
				}
			},
			null
		);
	}
</script>

{#if picker && pickerScene}
	<TransitionPicker
		x={picker.x}
		y={picker.y}
		after={picker.after}
		value={pickerScene.transition.kind}
		onchange={(kind) => {
			editor.setTransition(pickerScene.id, kind);
			const placed = editor.placed.find((p) => p.scene.id === pickerScene.id);
			// Show the new transition: jump to just before the cut.
			if (placed && kind !== 'cut') editor.seek(Math.max(0, placed.end - 0.6));
			picker = null;
		}}
		onclose={() => (picker = null)}
	/>
{/if}

{#if rangeMenu && rangeMenuButton}
	<Menu
		label="Range"
		items={rangeMenuItems}
		anchor={rangeMenuButton}
		align="end"
		onclose={() => (rangeMenu = false)}
	/>
{/if}

{#if trackMenu}
	<Menu
		label="{trackMenu.track.name} options"
		items={trackMenuItems(trackMenu.track)}
		anchor={trackMenu.anchor}
		onclose={() => (trackMenu = null)}
	/>
{/if}

{#if deletingTrack}
	{@const count = editor.itemsOnTrack(deletingTrack.id)}
	<ConfirmDialog
		title="Delete “{deletingTrack.name}”?"
		message="The {count === 1
			? 'item'
			: `${count} items`} on it will be removed too. You can undo this."
		actions={[
			{
				label: 'Delete track',
				onclick: () => {
					editor.deleteTrack(deletingTrack!.id);
					deletingTrack = null;
				}
			}
		]}
		danger
		oncancel={() => (deletingTrack = null)}
	/>
{/if}

<section
	class="storyboard"
	class:zooming
	aria-label="Storyboard"
	style:height={height ? `${height}px` : undefined}
	onpointerdown={onEmptyPointerDown}
>
	<div class="zoom">
		<!-- Compact, so the toolbar covers as little of the ruler as it can. -->
		<div class="range-tools" role="group" aria-label="Range">
			<button
				type="button"
				class="fit icon"
				aria-label="Range start at the playhead"
				title="Start the range at the playhead (I)"
				onclick={() => editor.setRangeStart()}
			>
				<ArrowRightToLine size={13} strokeWidth={2} aria-hidden="true" />
			</button>
			<button
				type="button"
				class="fit icon"
				aria-label="Range end at the playhead"
				title="End the range at the playhead (O)"
				onclick={() => editor.setRangeEnd()}
			>
				<ArrowLeftToLine size={13} strokeWidth={2} aria-hidden="true" />
			</button>
			<button
				bind:this={rangeMenuButton}
				type="button"
				class="fit icon"
				aria-label="More range options"
				aria-haspopup="menu"
				title="Range options"
				onclick={() => (rangeMenu = !rangeMenu)}
			>
				<Ellipsis size={13} strokeWidth={2} aria-hidden="true" />
			</button>
		</div>
		<button
			type="button"
			class="fit ripple"
			aria-pressed={editor.ripple}
			title={editor.ripple
				? 'Ripple is on: when scenes change, what’s on the other tracks moves along with them'
				: 'Ripple is off: when scenes change, what’s on the other tracks keeps its time'}
			onclick={() => editor.setRipple(!editor.ripple)}
		>
			<MoveHorizontal size={12} strokeWidth={2} aria-hidden="true" />
			Ripple
		</button>
		<button
			type="button"
			class="fit"
			title="Show the whole video"
			aria-pressed={zoom === 0}
			onclick={fit}
		>
			<Maximize size={12} strokeWidth={2} aria-hidden="true" />
			Fit
		</button>
		<input
			type="range"
			aria-label="Storyboard zoom"
			aria-valuetext={zoom === 0 ? 'Whole video' : `${Math.round(pps)} pixels per second`}
			min="0"
			max="1"
			step="0.01"
			value={ppsToZoom(pps, fittedPps)}
			oninput={(e) => void zoomAround(Number(e.currentTarget.value))}
		/>
	</div>

	<!-- One scroller for all tracks: headers stay on the left when scrolling sideways; the ruler
		stays on top and the Scenes track stays in view when scrolling up and down. The browser's own
		drag of pictures or selected text would swallow a drag's release, so it's turned off. -->
	<div
		class="tracks"
		ondragstart={preventNativeDrag}
		role="presentation"
		bind:this={tracks}
		bind:clientWidth={trackWidth}
		onscroll={() => (scrollLeft = tracks.scrollLeft)}
	>
		<div
			class="grid"
			bind:this={grid}
			style:width="{HEADER_W + contentWidth + TRACK_PAD}px"
			style:--header-w="{HEADER_W}px"
		>
			<!-- Ruler: click or drag to move the playhead -->
			<div class="row ruler-row">
				<div class="header corner">
					<button type="button" class="add-track" onclick={() => editor.addTrack('overlay', 0)}>
						<Plus size={12} strokeWidth={2.2} aria-hidden="true" />Overlay track
					</button>
				</div>
				<div class="ruler" role="presentation" bind:this={rulerLane} onpointerdown={onRulerDown}>
					{#if editor.project.range}
						{@const r = editor.project.range}
						<!-- The range set with I and O: drag its edges to change it. -->
						<div
							class="range"
							data-testid="range"
							style:left="{map.x(r.start)}px"
							style:width="{Math.max(2, map.x(r.end) - map.x(r.start))}px"
						>
							{#each ['start', 'end'] as const as edge (edge)}
								<span
									class="range-edge {edge}"
									role="slider"
									tabindex="-1"
									aria-label="Range {edge}"
									aria-valuenow={edge === 'start' ? r.start : r.end}
									data-range-edge={edge}
									onpointerdown={(e) => onRangeEdgeDown(e, edge)}
								></span>
							{/each}
						</div>
					{/if}
					{#each rulerTicks as t (t)}
						<span class="tick mono" style:left="{map.x(t)}px">{formatClock(t)}</span>
					{/each}
				</div>
			</div>

			{#each trackList as track, index (track.id)}
				{#if (dropTarget?.target.kind === 'gap' && dropTarget.target.index === index) || reorder?.index === index}
					<div class="gap-line" aria-hidden="true"></div>
				{/if}
				{#if track.kind === 'main'}
					<!-- Scenes -->
					<div class="row main-row" data-track-row data-track-id={track.id}>
						<div class="header"><TrackHeader {track} /></div>
						<div
							bind:this={scenesRow}
							class="lane scenes-row"
							class:dragging={drag?.active}
							role="group"
							aria-label="Scenes"
							ondragover={onMediaDragOver}
							ondragleave={() => (dropIndex = null)}
							ondrop={onMediaDrop}
						>
							{#if dropIndex !== null}
								<span class="drop-marker" style:left="{gapX(dropIndex) - 1}px" aria-hidden="true"
								></span>
							{/if}
							{#each layout.items as item (item.scene.id)}
								{@const isDragged = drag?.active && drag.id === item.scene.id}
								{@const isTrimmed = trim?.id === item.scene.id}
								{@const selected = editor.selectedId === item.scene.id}
								<div
									class="card-slot"
									class:lifted={isDragged}
									class:trimming={isTrimmed}
									data-scene-id={item.scene.id}
									style:left="{isDragged ? drag!.x : item.left}px"
									style:translate={isDragged && drag?.toLayers ? `0 ${drag.dy}px` : undefined}
									class:to-layers={isDragged && !!drag?.toLayers}
									style:width="{item.width}px"
									role="presentation"
									onpointerdown={(e) => onCardPointerDown(e, item)}
								>
									<SceneCard
										index={item.index}
										name={item.scene.name}
										duration={item.duration}
										width={Math.max(24, item.width - CARD_GAP)}
										thumbnail={thumbnailFor(item.scene)}
										scene={item.scene}
										tileAspect={formatRatio(editor.project.format)}
										sourceSize={editor.sourceSize(item.scene) ?? undefined}
										frozen={!!trim || !!drag?.active}
										{selected}
										onselect={() => onCardClick(item.scene.id)}
										onkeydown={(e) => onCardKeydown(e, item)}
									/>
									{#if item.scene.kind === 'video' && item.scene.volume > 0 && editor.media[item.scene.mediaId]?.hasAudio && !drag?.active && !trim}
										{@const p = editor.placed.find((x) => x.scene.id === item.scene.id)}
										{@const w = Math.max(24, item.width - CARD_GAP)}
										{#if p}
											<!-- The clip's own sound: its volume line across the picture. -->
											<div class="card-volume">
												<VolumeLine
													itemId={item.scene.id}
													width={w}
													height={CARD_PICTURE_H}
													xOf={(t) => ((t - p.start) / p.duration) * w}
													tOf={(px) => p.start + (px / w) * p.duration}
													{services}
												/>
											</div>
										{/if}
									{/if}
									{#if item.scene.keyframes?.length && item.scene.frame?.mode === 'custom' && !drag?.active}
										{@const p = editor.placed.find((x) => x.scene.id === item.scene.id)}
										{@const w = Math.max(24, item.width - CARD_GAP)}
										{#if p}
											<div class="card-keyframes">
												<KeyframeMarkers
													itemId={item.scene.id}
													xOf={(t) => ((t - p.start) / p.duration) * w}
													tOf={(px) => p.start + (px / w) * p.duration}
													{services}
													width={w}
												/>
											</div>
										{/if}
									{/if}
									{#if !drag?.active}
										{#each ['start', 'end'] as const as edge (edge)}
											<span
												class="trim-handle {edge}"
												class:visible={selected || isTrimmed}
												aria-hidden="true"
												title={edge === 'start' ? 'Drag to trim the start' : 'Drag to trim the end'}
												onpointerdown={(e) => onTrimPointerDown(e, item, edge)}
											></span>
										{/each}
									{/if}
									{#if isTrimmed}
										<span class="trim-badge mono">{formatShort(item.duration)}</span>
									{/if}
								</div>
							{/each}
							{#if !drag?.active && !trim}
								{#each layout.items.slice(0, -1) as item (item.scene.id)}
									<div
										class="transition-slot"
										style:left="{item.left + item.width - CARD_GAP / 2}px"
									>
										<TransitionButton
											kind={item.scene.transition.kind}
											after={item.index + 1}
											active={picker?.sceneId === item.scene.id}
											onclick={(e) => openPicker(e, item)}
										/>
									</div>
								{/each}
							{/if}
							{#each { length: importing } as _, i (i)}
								<div
									class="loading-card"
									style:left="{layout.end + i * (LOADING_CARD_W + CARD_GAP)}px"
									style:width="{LOADING_CARD_W}px"
									aria-label="Adding a clip"
									role="img"
								>
									<LoaderCircle size={18} strokeWidth={1.8} aria-hidden="true" />
									<span>Adding…</span>
								</div>
							{/each}
							{#if scenes.length === 0 && importing === 0}
								<p class="empty-hint" style:left="{ADD_CARD_W + CARD_GAP * 2}px">
									Your scenes line up here, in the order they play.
								</p>
							{/if}
							<button
								type="button"
								class="add-scene"
								style:left="{layout.end + loadingWidth}px"
								style:width="{ADD_CARD_W}px"
								onclick={onaddscene}
							>
								<Plus size={16} strokeWidth={2} aria-hidden="true" />
								Scene
							</button>
						</div>
					</div>
				{:else}
					<div
						class="row track-row {track.kind}"
						class:moving={reorder?.id === track.id}
						class:target={dropTarget?.target.kind === 'track' && dropTarget.target.id === track.id}
						data-track-row
						data-track-id={track.id}
					>
						<div class="header">
							<TrackHeader
								{track}
								renaming={renamingId === track.id}
								onrenamedone={() => (renamingId = null)}
								onmenu={(anchor) => (trackMenu = { track, anchor })}
								onreorder={(e) => onHeaderPointerDown(e, track)}
							/>
						</div>
						<div
							class="lane"
							class:drop-hover={laneDrop?.trackId === track.id}
							role="group"
							aria-label={track.name}
							data-track-lane={track.id}
							ondragover={(e) => onLaneDragOver(e, track.id)}
							ondragleave={(e) => {
								if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) laneDrop = null;
							}}
							ondrop={(e) => onLaneDrop(e, track.id)}
						>
							<TrackLane {track} {map} height={trackHeight(track, itemKinds)} {services} />
							{#if laneDrop?.trackId === track.id}
								<span
									class="drop-ghost"
									aria-hidden="true"
									style:left="{map.x(laneDrop.start)}px"
									style:width="{map.width(laneDrop.start, 5) - 3}px"
								>
									<span>Place here</span>
								</span>
							{/if}
						</div>
					</div>
				{/if}
			{/each}
			{#if (dropTarget?.target.kind === 'gap' && dropTarget.target.index === trackList.length) || reorder?.index === trackList.length}
				<div class="gap-line" aria-hidden="true"></div>
			{/if}
			<div class="row add-row">
				<div class="header">
					<button type="button" class="add-track" onclick={() => editor.addTrack('audio')}>
						<Plus size={12} strokeWidth={2.2} aria-hidden="true" />Audio track
					</button>
				</div>
			</div>

			{#if band}
				<span
					class="band"
					aria-hidden="true"
					style:left="{band.left}px"
					style:top="{band.top}px"
					style:width="{band.width}px"
					style:height="{band.height}px"
				></span>
			{/if}

			{#if snapX !== null}
				<!-- A dragged item has snapped here. -->
				<span
					class="snap-line"
					style:left="{HEADER_W + snapX}px"
					style:visibility={snapX < scrollLeft ? 'hidden' : undefined}
					aria-hidden="true"
				></span>
			{/if}

			<!-- Playhead -->
			<div
				class="playhead"
				style:translate="{HEADER_W + map.x(editor.time)}px 0"
				style:visibility={map.x(editor.time) < scrollLeft - 1 ? 'hidden' : undefined}
			>
				<button
					type="button"
					class="handle"
					aria-label="Playhead at {formatClock(editor.time)}. Use arrow keys to move."
					onpointerdown={onRulerDown}
					onkeydown={onPlayheadKey}
				></button>
			</div>
		</div>
	</div>
</section>

<style>
	/* Zoom sits at the right end of the ruler, above the scrolling tracks. */
	/* The storyboard's own toolbar: a slim row above the ruler, so it never covers it. */
	.zoom {
		display: flex;
		flex: none;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2);
		height: var(--toolbar-h);
		padding: 0 var(--space-6) 2px;
	}
	.fit {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 20px;
		padding: 0 8px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: var(--color-bg);
		color: var(--color-muted);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
	}
	.fit:hover {
		border-color: var(--color-ink);
		color: var(--color-ink);
	}
	.fit[aria-pressed='true'] {
		color: var(--color-ink);
	}
	.ripple[aria-pressed='true'] {
		border-color: var(--color-ink);
		background: var(--color-ink);
		color: var(--color-on-ink);
	}
	.zoom input {
		width: 110px;
		accent-color: var(--color-ink);
	}
	.storyboard {
		position: relative;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		--ruler-h: 26px;
		--toolbar-h: 28px;
		--scenes-h: 104px;
		--row-gap: 6px;
		padding: 4px 0 var(--space-4);
		border-top: 1px solid var(--color-border);
		background: var(--color-bg);
	}

	@media (max-width: 1279px) {
		.storyboard {
			--scenes-h: 88px;
			--ruler-h: 24px;
			padding-bottom: var(--space-3);
		}
	}

	.tracks {
		position: relative;
		/* Its rows stack among themselves, under the zoom controls. */
		isolation: isolate;
		/* The storyboard's height is set with the divider; the tracks scroll inside it. */
		flex: 1;
		min-height: 0;
		overflow: auto;
		scrollbar-width: thin;
	}
	.grid {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--row-gap);
		min-width: 100%;
	}
	.row {
		position: relative;
		display: flex;
		flex: none;
	}
	/* Track headers stay on the left when scrolling sideways. */
	.header {
		position: sticky;
		left: 0;
		z-index: 14;
		flex: none;
		width: var(--header-w);
		background: var(--color-bg);
	}
	.ruler-row {
		position: sticky;
		top: 0;
		z-index: 15;
		background: var(--color-bg);
	}
	.main-row {
		z-index: 12;
		background: var(--color-bg);
		padding: 2px 0;
	}

	.corner {
		display: flex;
		align-items: center;
		padding-left: var(--space-5);
	}
	.add-row .header {
		height: 22px;
		display: flex;
		align-items: center;
		padding-left: var(--space-5);
	}
	.add-track {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		height: 22px;
		padding: 0 6px 0 4px;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-muted);
		font: inherit;
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.add-track:hover {
		background: var(--color-surface);
		color: var(--color-ink);
	}
	.band {
		position: absolute;
		z-index: 18;
		border: 1px solid var(--color-ink);
		border-radius: 2px;
		background: color-mix(in srgb, var(--color-ink) 8%, transparent);
		pointer-events: none;
	}
	.track-row.moving {
		opacity: 0.5;
	}
	.lane {
		position: relative;
		flex: 1;
		min-width: 0;
		border-radius: var(--radius-sm);
		background: var(--color-surface);
	}
	.track-row.target .lane {
		box-shadow: inset 0 0 0 1.5px var(--color-ink);
	}
	.lane.drop-hover {
		box-shadow: inset 0 0 0 1.5px var(--color-ink);
	}
	.drop-ghost {
		position: absolute;
		top: 2px;
		bottom: 2px;
		z-index: 8;
		display: flex;
		align-items: flex-end;
		padding: 4px 6px;
		border: 2px dashed var(--color-ink);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-bg) 70%, transparent);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		pointer-events: none;
	}
	.gap-line {
		position: relative;
		flex: none;
		height: 0;
		margin-left: var(--header-w);
		z-index: 17;
	}
	.gap-line::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: -2px;
		height: 3px;
		border-radius: 2px;
		background: var(--color-ink);
	}

	.snap-line {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		margin-left: -0.5px;
		background: var(--color-ink);
		opacity: 0.5;
		pointer-events: none;
		/* Across every track, the Scenes track included (under the headers). */
		z-index: 16;
	}
	.ruler {
		position: relative;
		flex: 1;
		height: var(--ruler-h);
		border-bottom: 1px solid var(--color-border);
		cursor: ew-resize;
		touch-action: none;
	}
	.range {
		position: absolute;
		top: 0;
		bottom: 0;
		background: color-mix(in srgb, var(--color-ink) 12%, transparent);
		border-left: 2px solid var(--color-ink);
		border-right: 2px solid var(--color-ink);
	}
	.range-edge {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 12px;
		cursor: ew-resize;
		touch-action: none;
	}
	/* A small grip at the bottom of each edge: easy to grab even under the playhead's knob. */
	.range-edge::after {
		content: '';
		position: absolute;
		left: 50%;
		bottom: 0;
		width: 8px;
		height: 9px;
		translate: -50% 0;
		border-radius: 2px 2px 0 0;
		background: var(--color-ink);
	}
	.range-edge.start {
		left: -7px;
	}
	.range-edge.end {
		right: -7px;
	}
	.range-tools {
		display: inline-flex;
		gap: 4px;
		margin-right: var(--space-2);
	}
	.fit.icon {
		padding: 0 5px;
	}
	.fit:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.tick {
		position: absolute;
		top: 4px;
		padding-left: 5px;
		border-left: 1px solid var(--color-border);
		font-size: var(--text-xs);
		color: var(--color-muted);
		line-height: 1;
		height: 14px;
		pointer-events: none;
		user-select: none;
	}

	.scenes-row {
		height: var(--scenes-h);
		background: none;
	}
	.card-volume {
		position: absolute;
		left: 0;
		top: 3px;
		width: 100%;
		height: 70px;
		pointer-events: none;
	}
	/* Scene keyframes: along the bottom of the picture, above the name. */
	.card-keyframes {
		position: absolute;
		left: 0;
		top: calc(100% - 30px);
		height: 12px;
		width: 100%;
		pointer-events: none;
	}
	.card-keyframes :global(.kf) {
		pointer-events: auto;
	}
	.card-slot {
		position: absolute;
		top: 0;
		bottom: 0;
		display: flex;
		touch-action: none;
		user-select: none;
		transition:
			left var(--dur) var(--ease-out),
			width var(--dur) var(--ease-out);
	}
	.card-slot.trimming,
	.zooming .card-slot {
		transition: none;
	}
	.card-slot.lifted {
		z-index: 6;
		transition: none;
		cursor: grabbing;
	}
	.card-slot.to-layers {
		opacity: 0.85;
	}
	.card-slot.lifted :global(.card) {
		box-shadow: var(--shadow-float);
		transform: translateY(-4px) rotate(-1deg);
	}

	.trim-handle {
		position: absolute;
		top: 10px;
		bottom: 26px;
		width: 10px;
		border-radius: 4px;
		background: var(--color-accent);
		cursor: ew-resize;
		opacity: 0;
		z-index: 3;
		transition: opacity var(--dur-fast) var(--ease-out);
		touch-action: none;
	}
	.trim-handle::after {
		content: '';
		position: absolute;
		inset: 30% 4px;
		border-radius: 1px;
		background: var(--color-bg);
	}
	.trim-handle.start {
		left: -3px;
	}
	.trim-handle.end {
		right: calc(10px - 3px);
	}
	/* Bigger handles for fingers on tablets. */
	@media (pointer: coarse) {
		.trim-handle {
			width: 18px;
		}
		.trim-handle.end {
			right: calc(10px - 7px);
		}
		.trim-handle.start {
			left: -7px;
		}
	}
	.card-slot:hover .trim-handle,
	.trim-handle.visible {
		opacity: 1;
	}
	.card-slot:hover .trim-handle:not(.visible) {
		background: var(--color-ink);
	}
	.trim-badge {
		position: absolute;
		top: -22px;
		left: 50%;
		translate: -50% 0;
		padding: 2px 8px;
		border-radius: var(--radius-pill);
		background: var(--color-ink);
		color: var(--color-on-ink);
		font-size: var(--text-xs);
		white-space: nowrap;
		z-index: 7;
	}

	.transition-slot {
		position: absolute;
		top: 50%;
		translate: -50% -70%;
		/* Above the trim handles, which stay grabbable above and below the button. */
		z-index: 5;
		animation: fade-in var(--dur) var(--ease-out);
	}
	.add-scene {
		position: absolute;
		top: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border: 1.5px dashed var(--color-border);
		border-radius: var(--radius-card);
		background: var(--color-bg);
		color: var(--color-muted);
		font-weight: var(--weight-medium);
		transition:
			border-color var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			left var(--dur) var(--ease-out);
	}
	.add-scene:hover {
		border-color: var(--color-ink);
		color: var(--color-ink);
	}

	.drop-marker {
		position: absolute;
		top: -4px;
		bottom: -4px;
		width: 3px;
		margin-left: -6px;
		border-radius: 2px;
		background: var(--color-ink);
		z-index: 8;
		pointer-events: none;
	}
	.loading-card {
		position: absolute;
		top: 0;
		bottom: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		border-radius: var(--radius-card);
		background: var(--color-surface);
		color: var(--color-muted);
		font-size: var(--text-sm);
		animation: pulse 1.2s ease-in-out infinite;
	}
	.loading-card :global(svg) {
		animation: spin 0.9s linear infinite;
	}
	.empty-hint {
		position: absolute;
		top: 50%;
		translate: 0 -50%;
		color: var(--color-muted);
		white-space: nowrap;
	}
	@keyframes spin {
		to {
			rotate: 360deg;
		}
	}
	@keyframes pulse {
		50% {
			opacity: 0.6;
		}
	}
	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}

	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 2px;
		margin-left: -1px;
		background: var(--color-accent);
		pointer-events: none;
		z-index: 16;
		will-change: translate;
	}
	.handle {
		position: absolute;
		top: 6px;
		left: 50%;
		width: 14px;
		height: 14px;
		translate: -50% 0;
		padding: 0;
		border: 2px solid var(--color-bg);
		border-radius: 50%;
		background: var(--color-accent);
		box-shadow: var(--shadow-card);
		cursor: ew-resize;
		pointer-events: auto;
		touch-action: none;
	}
	.handle:focus-visible {
		box-shadow:
			0 0 0 2px var(--color-bg),
			0 0 0 4px var(--color-accent);
	}
</style>
