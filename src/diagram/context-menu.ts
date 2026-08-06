import { t } from '../i18n.js';
import type { ContextCommand, ContextCommandGroup, ContextMenuItemState } from './api.js';

/**
 * The control's own context menu.
 *
 * It exists because right-click already suppresses the browser's menu whether or not anyone
 * is listening. A control that takes the native menu away owes one back, so this is on by
 * default; a host with its own menu turns it off (`showContextMenu: false`) and keeps using
 * `contextMenuRequested`, which is emitted either way.
 *
 * Styling follows the fullscreen button: inline styles driven by `--ssdiagram-*` custom
 * properties with sensible fallbacks, so the menu is usable with no stylesheet at all and
 * retintable without one. Class names are stable for hosts that would rather use CSS.
 */

const ROOT_CLASS = 'ssdiagram-context-menu';
const ITEM_CLASS = 'ssdiagram-context-menu-item';
const SUBMENU_CLASS = 'ssdiagram-context-menu-submenu';
const SEPARATOR_CLASS = 'ssdiagram-context-menu-separator';
const LABEL_CLASS = 'ssdiagram-context-menu-label';
const ARROW_CLASS = 'ssdiagram-context-menu-arrow';
const CHECK_CLASS = 'ssdiagram-context-menu-check';

/** A rule below these entries, so related commands read as blocks rather than one long list. */
const SEPARATE_AFTER: ReadonlySet<string> = new Set(['redo', 'paste', 'delete', 'overview']);

function label(id: ContextCommand | ContextCommandGroup): string {
    switch (id) {
        case 'undo': return t('undo', 'Undo');
        case 'redo': return t('redo', 'Redo');
        case 'cut': return t('cut', 'Cut');
        case 'copy': return t('copy', 'Copy');
        case 'paste': return t('paste', 'Paste');
        case 'open': return t('ctxOpen', 'Open');
        case 'delete': return t('ctxDelete', 'Delete');
        case 'export': return t('ctxExportAs', 'Export as');
        case 'exportDocument': return t('ctxExportDocument', 'Scheme');
        case 'exportPng': return t('ctxExportPng', 'PNG image');
        case 'exportSvg': return t('ctxExportSvg', 'SVG image');
        case 'overview': return t('ctxOverview', 'Overview');
        case 'properties': return t('properties', 'Properties');
        case 'help': return t('ctxHelp', 'Help');
    }
}

const PANEL_STYLE: Partial<CSSStyleDeclaration> = {
    position: 'fixed',
    zIndex: '2147483000',
    minWidth: '176px',
    // Translations run longer than English -- German and Russian routinely half again. Without
    // a cap the panel just grows, and on a narrow viewport it leaves the screen entirely, which
    // no amount of repositioning can recover.
    maxWidth: 'min(320px, calc(100vw - 16px))',
    padding: '4px',
    border: '1px solid var(--ssdiagram-menu-border, var(--ssdiagram-control-border, var(--t-border, #3a4250)))',
    borderRadius: '7px',
    background: 'var(--ssdiagram-menu-background, var(--ssdiagram-control-background, var(--t-panel, #181a20)))',
    color: 'var(--ssdiagram-menu-color, var(--ssdiagram-control-color, var(--t-text, #eaecef)))',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
    font: 'var(--ssdiagram-menu-font, 12.5px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif)',
    boxSizing: 'border-box',
    userSelect: 'none',
};

const ITEM_STYLE: Partial<CSSStyleDeclaration> = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    padding: '6px 10px',
    border: '0',
    borderRadius: '4px',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    // Logical, not physical: on an RTL page these follow the writing direction instead of
    // pinning the text left and truncating from the wrong end.
    textAlign: 'start',
    overflowWrap: 'anywhere',
    cursor: 'pointer',
    boxSizing: 'border-box',
};

const HOVER_BACKGROUND = 'var(--ssdiagram-menu-hover, var(--t-hover, rgba(255, 255, 255, 0.08)))';
const DISABLED_COLOR = 'var(--ssdiagram-menu-disabled-color, var(--t-text-dim, #848e9c))';

export interface ContextMenuViewOptions {
    /** Where the menu is appended. The diagram mount point, so it survives a fullscreened panel. */
    container: HTMLElement;
    /** Runs the picked command. The same entry point a host menu would use. */
    execute: (command: ContextCommand) => void;
}

export class ContextMenuView {
    private readonly container: HTMLElement;
    private readonly execute: (command: ContextCommand) => void;
    private root: HTMLElement | null = null;
    private submenu: HTMLElement | null = null;
    private readonly submenuTriggers = new Map<HTMLElement, HTMLElement>();
    private readonly detach: Array<() => void> = [];

    constructor(options: ContextMenuViewOptions) {
        this.container = options.container;
        this.execute = options.execute;
    }

    get isOpen(): boolean {
        return this.root !== null;
    }

    show(x: number, y: number, items: readonly ContextMenuItemState[]): void {
        this.hide();
        const owner = this.container.ownerDocument ?? document;
        const root = this.panel(owner);
        root.className = ROOT_CLASS;
        root.setAttribute('role', 'menu');

        const gutter = items.some((item) => !('group' in item) && item.checked !== undefined);
        items.forEach((item, index) => {
            if ('group' in item) root.appendChild(this.groupEntry(owner, item, gutter));
            else root.appendChild(this.commandEntry(owner, item.command, item.enabled, true, item.checked, gutter));
            const id = 'group' in item ? item.group : item.command;
            if (SEPARATE_AFTER.has(id) && index < items.length - 1) root.appendChild(this.separator(owner));
        });

        // A right-click inside our own menu is not "outside", so the dismissal watcher lets it
        // through -- and the canvas listener that suppresses the native menu never sees it,
        // because the menu is not a child of the canvas. Without this the browser drew its own
        // menu on top of ours, leaving two stacked over each other.
        this.on(root, 'contextmenu', (event) => { event.preventDefault(); });

        this.container.appendChild(root);
        this.root = root;
        this.place(root, x, y);
        this.watchForDismissal(owner);
    }

    hide(): void {
        for (const dispose of this.detach.splice(0)) dispose();
        this.submenu = null;
        this.submenuTriggers.clear();
        this.root?.remove();
        this.root = null;
    }

    destroy(): void {
        this.hide();
    }

    private panel(owner: Document): HTMLElement {
        const panel = owner.createElement('div');
        Object.assign(panel.style, PANEL_STYLE);
        return panel;
    }

    private separator(owner: Document): HTMLElement {
        const rule = owner.createElement('div');
        rule.className = SEPARATOR_CLASS;
        Object.assign(rule.style, {
            height: '1px',
            margin: '4px 6px',
            background: 'var(--ssdiagram-menu-border, var(--t-border, #3a4250))',
        });
        return rule;
    }

    private item(
        owner: Document,
        text: string,
        enabled: boolean,
        arrow: boolean,
        checked: boolean | undefined,
        gutter: boolean,
    ): HTMLButtonElement {
        const button = owner.createElement('button');
        button.type = 'button';
        button.className = ITEM_CLASS;
        button.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemcheckbox');
        if (checked !== undefined) button.setAttribute('aria-checked', String(checked));
        Object.assign(button.style, ITEM_STYLE);
        if (!enabled) {
            button.disabled = true;
            button.style.color = DISABLED_COLOR;
            button.style.cursor = 'default';
        }

        // Every item in a panel that has a checkable entry gets the same gutter, so the
        // captions stay on one line rather than one row sitting further in than the rest.
        if (gutter) {
            const tick = owner.createElement('span');
            tick.className = CHECK_CLASS;
            tick.textContent = checked === true ? '✓' : '';
            tick.setAttribute('aria-hidden', 'true');
            Object.assign(tick.style, { flex: 'none', width: '12px', textAlign: 'center' });
            button.appendChild(tick);
        }

        const caption = owner.createElement('span');
        caption.className = LABEL_CLASS;
        caption.textContent = text;
        caption.style.flex = '1';
        button.appendChild(caption);

        if (arrow) {
            const chevron = owner.createElement('span');
            chevron.className = ARROW_CLASS;
            // Points the way the submenu actually opens, which on an RTL page is the other way.
            chevron.textContent = this.rtl() ? '‹' : '›';
            chevron.setAttribute('aria-hidden', 'true');
            Object.assign(chevron.style, { flex: 'none', opacity: '0.7', fontSize: '14px' });
            button.appendChild(chevron);
        }
        return button;
    }

    // `closesSubmenu` separates the two places an item can live. A top-level item shuts any
    // open submenu when the pointer arrives, the way menus everywhere behave. An item inside
    // the submenu must not: reaching it means the pointer has entered that very panel, and
    // closing it there would pull it out from under the pointer and drop the click on the
    // canvas behind.
    private commandEntry(
        owner: Document,
        command: ContextCommand,
        enabled: boolean,
        closesSubmenu: boolean,
        checked: boolean | undefined,
        gutter: boolean,
    ): HTMLElement {
        const button = this.item(owner, label(command), enabled, false, checked, gutter);
        this.on(button, 'pointerenter', () => {
            if (closesSubmenu) this.closeSubmenu();
            if (enabled) button.style.background = HOVER_BACKGROUND;
        });
        this.on(button, 'pointerleave', () => { button.style.background = 'transparent'; });
        this.on(button, 'click', () => {
            if (!enabled) return;
            // Hide first: a command may open a dialog, and a menu left on top of it looks stuck.
            this.hide();
            this.execute(command);
        });
        return button;
    }

    private groupEntry(
        owner: Document,
        group: { group: ContextCommandGroup; enabled: boolean; commands: readonly { command: ContextCommand; enabled: boolean; checked?: boolean }[] },
        gutter: boolean,
    ): HTMLElement {
        const host = owner.createElement('div');
        host.style.position = 'relative';

        const button = this.item(owner, label(group.group), group.enabled, true, undefined, gutter);
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');
        host.appendChild(button);

        const panel = this.panel(owner);
        panel.className = SUBMENU_CLASS;
        panel.setAttribute('role', 'menu');
        panel.setAttribute('aria-label', label(group.group));
        // insetInlineStart, not left: the submenu opens towards the end of the line, which
        // is the right on an LTR page and the left on an RTL one.
        Object.assign(panel.style, { position: 'absolute', insetInlineStart: '100%', top: '-5px', display: 'none' });
        const childGutter = group.commands.some((child) => child.checked !== undefined);
        for (const child of group.commands) {
            panel.appendChild(this.commandEntry(owner, child.command, child.enabled, false, child.checked, childGutter));
        }
        host.appendChild(panel);

        const open = (): void => {
            if (!group.enabled) return;
            button.style.background = HOVER_BACKGROUND;
            button.setAttribute('aria-expanded', 'true');
            panel.style.display = 'block';
            this.submenu = panel;
            this.keepOnScreen(panel);
        };
        this.on(button, 'pointerenter', open);
        // Tap opens it too: a touch device never sends pointerenter on its own.
        this.on(button, 'click', open);
        this.on(host, 'pointerleave', () => {
            if (this.submenu !== panel) return;
            button.style.background = 'transparent';
            button.setAttribute('aria-expanded', 'false');
            panel.style.display = 'none';
            this.submenu = null;
        });
        this.submenuTriggers.set(panel, button);
        return host;
    }

    private closeSubmenu(): void {
        if (this.submenu === null) return;
        this.submenu.style.display = 'none';
        this.submenuTriggers.get(this.submenu)?.setAttribute('aria-expanded', 'false');
        this.submenu = null;
    }

    /**
     * The window the menu actually lives in. A component created from one document and mounted
     * into another -- a same-origin iframe, a popup -- must be measured and dismissed against
     * that document's window, not the one this module happened to be evaluated in.
     */
    private get view(): (Window & typeof globalThis) | null {
        const owner = this.container.ownerDocument ?? (typeof document === 'undefined' ? null : document);
        const view = owner?.defaultView ?? (typeof window === 'undefined' ? null : window);
        return view ?? null;
    }

    // Reads the resolved writing direction so the submenu's side and its arrow agree with it.
    private rtl(): boolean {
        if (typeof getComputedStyle !== 'function') return false;
        try {
            return getComputedStyle(this.container).direction === 'rtl';
        } catch {
            // A detached or fake container has no computed style; left-to-right is the safe read.
            return false;
        }
    }

    /** Keeps the panel inside the viewport, flipping it left when it would run off the edge. */
    private keepOnScreen(panel: HTMLElement): void {
        const view = this.view;
        if (typeof panel.getBoundingClientRect !== 'function' || view === null) return;
        const box = panel.getBoundingClientRect();
        if (box.right > view.innerWidth - 4 || box.left < 4) {
            panel.style.insetInlineStart = 'auto';
            panel.style.insetInlineEnd = '100%';
        }
        if (box.bottom > view.innerHeight - 4) {
            panel.style.top = 'auto';
            panel.style.bottom = '-5px';
        }
    }

    private place(root: HTMLElement, x: number, y: number): void {
        root.style.left = `${x}px`;
        root.style.top = `${y}px`;
        const view = this.view;
        if (typeof root.getBoundingClientRect !== 'function' || view === null) return;
        const box = root.getBoundingClientRect();
        // Flip rather than clamp: a menu shoved back onto the screen would cover the very
        // thing that was right-clicked.
        if (box.right > view.innerWidth - 4) root.style.left = `${Math.max(4, x - box.width)}px`;
        if (box.bottom > view.innerHeight - 4) root.style.top = `${Math.max(4, y - box.height)}px`;
    }

    private watchForDismissal(owner: Document): void {
        const dismiss = (): void => this.hide();
        const outside = (event: Event): void => {
            // Duck-typed rather than `target instanceof Node`: this runs in whatever document
            // the host mounted us in, and a cross-document Node fails that check.
            const root = this.root;
            const target = event.target as Node | null;
            if (root !== null && target !== null && typeof root.contains === 'function' && root.contains(target)) return;
            this.hide();
        };
        this.on(owner, 'pointerdown', outside, true);
        this.on(owner, 'keydown', (event: Event) => {
            if ((event as KeyboardEvent).key === 'Escape') this.hide();
        });
        const view = this.view;
        if (view !== null) {
            // Scroll and resize move the diagram out from under the menu, which would otherwise
            // hang in place pointing at nothing.
            this.on(view, 'blur', dismiss);
            this.on(view, 'resize', dismiss);
            this.on(view, 'scroll', dismiss, true);
        }
    }

    private on(
        target: { addEventListener?: (type: string, listener: EventListener, options?: boolean) => void; removeEventListener?: (type: string, listener: EventListener, options?: boolean) => void },
        type: string,
        listener: EventListener,
        capture = false,
    ): void {
        if (typeof target.addEventListener !== 'function') return;
        target.addEventListener(type, listener, capture);
        this.detach.push(() => target.removeEventListener?.(type, listener, capture));
    }
}
