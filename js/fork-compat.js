"use strict";

/*
 * Fork compatibility shims.
 *
 * Upstream 5etools occasionally renames/reshapes globals that our fork-local pages (the Character
 * Builder and the Tabletop/VTT) depend on. Rather than touch hundreds of call sites on every sync,
 * we adapt in one place here. This file is fork-local (upstream doesn't have it), so it never causes
 * merge conflicts; it's loaded right after js/utils.js on our custom HTML pages.
 *
 * When a sync breaks something, add the adaptation here instead of editing charbuilder/cb-ui/vtt.
 */
(function () {
	const g = globalThis;

	/* v2.33.x — the DOM element-builder globals were renamed:
	 *   ee → veT   (TemplateUtil.getTagged — tagged-template element builder)
	 *   es → veEs  (ElementUtil.getBySelector — single)
	 *   e_ → veE   (ElementUtil.getOrModify)
	 *   (new)      veEm (ElementUtil.getBySelectorMulti) */
	const alias = (oldName, newName) => { if (typeof g[oldName] === "undefined" && typeof g[newName] !== "undefined") g[oldName] = g[newName]; };
	alias("ee", "veT");
	alias("es", "veEs");
	alias("e_", "veE");
	alias("esm", "veEm");

	/* v2.33.x — the fluent element API moved from flat methods on the element (ele.empty(), ele.onn(),
	 * ele.appendTo(), ele.val(), ele.find(), ...) into a namespaced ele.vee.* object. Our custom pages
	 * call the flat form in hundreds of places. Restore the flat aliases centrally by patching the one
	 * binding function every augmented element passes through — leaving ele.vee intact so upstream code
	 * (also loaded on our pages) keeps working. Only aliases names not already present on the element,
	 * so native DOM members (children, closest, focus, after, …) are never clobbered. */
	if (typeof g.ElementUtil !== "undefined" && typeof g.ElementUtil._getOrModify_bindMethods === "function" && !g.ElementUtil.__veeFlatPatched) {
		/* v2.37.x — vee became a lazily-created class instance (ElementUtil._ElementUtilVee) whose methods
		 * are non-enumerable prototype getters, so a for…in over vee no longer finds them. Derive the
		 * method names from the class's static "_"-prefixed implementations instead (falls back to the
		 * old enumerable-object shape). Flat aliases are lazy getters, so vee is only built on use. */
		const VeeClass = g.ElementUtil._ElementUtilVee;
		const veeNames = VeeClass
			? Object.getOwnPropertyNames(VeeClass).filter(n => n.startsWith("_") && typeof VeeClass[n] === "function").map(n => n.slice(1))
			: null;
		const origBind = g.ElementUtil._getOrModify_bindMethods.bind(g.ElementUtil);
		g.ElementUtil._getOrModify_bindMethods = function (ele) {
			origBind(ele);
			if (!ele || ele.__veeFlat) return;
			if (veeNames) {
				for (const k of veeNames) {
					if (k in ele) continue;
					Object.defineProperty(ele, k, {
						configurable: true,
						enumerable: false,
						get () { return this.vee[k]; },
						set (v) { Object.defineProperty(this, k, {configurable: true, writable: true, enumerable: true, value: v}); },
					});
				}
			} else {
				const vee = ele.vee;
				if (!vee) return;
				for (const k in vee) { if (typeof vee[k] === "function" && ele[k] == null) ele[k] = vee[k]; }
			}
			Object.defineProperty(ele, "__veeFlat", {value: true, enumerable: false, configurable: true});
		};
		g.ElementUtil.__veeFlatPatched = true;
	}
})();
