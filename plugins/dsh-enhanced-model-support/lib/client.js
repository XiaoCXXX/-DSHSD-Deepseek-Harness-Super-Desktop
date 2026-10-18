window.__ModuleLoader__.load({
	id: "dsh-enhanced-model-support",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");
		let _deepseek_ai_cordis = require("@deepseek-ai/cordis");

		//#region dictionaries
		const NS = 'model-slider';

		const zh = {
			'usage.title': '订阅用量',
			'usage.refresh': '刷新',
			'usage.loading': '读取中…',
			'usage.empty': '没有已登录的订阅账号。',
			'usage.missing': '未检测到订阅插件（dsh-plugin-subscriptions）。',
			'usage.unsupported': '该厂商不提供用量接口。',
			'usage.error': '读取失败：{message}',
			'usage.plan': '套餐：{plan}',
			'usage.resetCredits': '可用重置 {count} 次',
			'usage.windowSession': '5 小时窗口',
			'usage.windowWeekly': '每周窗口',
			'usage.windowOther': '其他窗口',
			'usage.resetsIn': '{time} 后重置',
			'usage.now': '即将重置',
			'trigger.fallback': '选择模型',
			'trigger.selectAria': '选择模型',
			'trigger.aria': '选择模型，当前 {model}',
			'trigger.ariaEffort': '选择模型，当前 {model}，思考强度 {effort}',
			'menu.aria': '模型与思考强度',
			'menu.model': '模型',
			'menu.effort': '思考强度',
			'effort.providerDefault': 'Default',
			'status.loading': '正在刷新模型列表…',
			'error.action': '模型操作失败：{message}',
			'action.reload': '重新加载',
			'warning.groupLoad': '{name} 加载失败：{message}',
			'empty.models': '没有可用的模型。',
			'empty.efforts': '当前模型未提供思考强度等级。',
			'desc.meaning': '调高强度可获得更详细的推理过程，但会消耗更多时间与资源。',
			'slider.aria': '思考强度：{effort}',
			'back.label': '返回'
		};

		const en = {
			'usage.title': 'Subscription usage',
			'usage.refresh': 'Refresh',
			'usage.loading': 'Reading…',
			'usage.empty': 'No subscription accounts are logged in.',
			'usage.missing': 'The subscriptions plugin (dsh-plugin-subscriptions) was not found.',
			'usage.unsupported': 'This provider exposes no usage endpoint.',
			'usage.error': 'Failed to read usage: {message}',
			'usage.plan': 'Plan: {plan}',
			'usage.resetCredits': '{count} resets available',
			'usage.windowSession': '5-hour window',
			'usage.windowWeekly': 'Weekly window',
			'usage.windowOther': 'Other window',
			'usage.resetsIn': 'Resets in {time}',
			'usage.now': 'Resetting shortly',
			'trigger.fallback': 'Select model',
			'trigger.selectAria': 'Select model',
			'trigger.aria': 'Select model, current {model}',
			'trigger.ariaEffort': 'Select model, current {model}, thinking strength {effort}',
			'menu.aria': 'Model and thinking strength',
			'menu.model': 'Model',
			'menu.effort': 'Thinking strength',
			'effort.providerDefault': 'Default',
			'status.loading': 'Refreshing model list…',
			'error.action': 'Model operation failed: {message}',
			'action.reload': 'Reload',
			'warning.groupLoad': '{name} failed to load: {message}',
			'empty.models': 'No models available.',
			'empty.efforts': 'This model provides no thinking strength levels.',
			'desc.meaning': 'Higher strength produces more detailed reasoning but costs more time and resources.',
			'slider.aria': 'Thinking strength: {effort}',
			'back.label': 'Back'
		};
		//#endregion

		//#region styles
		const CSS = `
.ths-root{min-width:0;position:relative}
.ths-trigger{min-width:0;max-width:220px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:24px;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:500;line-height:20px;display:flex}
.ths-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.ths-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.ths-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.ths-triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.ths-triggerEffort{color:#4a9eff;flex:none}
.ths-chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s;display:flex}
.ths-chevronOpen{transform:rotate(180deg)}
.ths-menu{z-index:20;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-specific-menu);width:min(280px,100vw - 32px);max-height:min(440px,100vh - 96px);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border-radius:12px;flex-direction:column;padding:4px;display:flex;position:absolute;bottom:calc(100% + 8px);right:0;overflow:hidden}
.ths-status,.ths-empty{color:var(--dsw-alias-label-tertiary);padding:10px;font-size:13px;line-height:20px}
.ths-error{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);border-radius:8px;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px;padding:7px 8px;font-size:12px;line-height:18px;display:flex}
.ths-warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}
.ths-retry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-weight:600}
.ths-cell{width:100%;border:none;background:0 0;color:inherit;font:inherit;text-align:left;border-radius:8px;align-items:center;gap:8px;min-height:32px;padding:0 8px;font-size:13px;line-height:20px;display:flex;cursor:pointer}
.ths-cell:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ths-cell:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:-2px}
.ths-cellLabel{flex:1;color:var(--dsw-alias-label-primary)}
.ths-cellValue{color:var(--dsw-alias-label-caption);text-overflow:ellipsis;white-space:nowrap;max-width:110px;overflow:hidden}
.ths-cellValueAccent{color:#4a9eff}
.ths-releaseBadge{display:inline-flex;align-items:center;margin-left:4px;padding:0 5px;height:16px;border-radius:4px;font-size:10px;font-weight:600;line-height:16px;color:#4a9eff;background:rgba(74,158,255,.15);vertical-align:baseline}
.ths-menuSlot{margin-top:2px;padding-top:4px;border-top:1px solid var(--dsw-alias-border-l3);max-height:240px;overflow:auto}
.ths-usageSlot{margin-top:2px;padding-top:4px;border-top:1px solid var(--dsw-alias-border-l3);max-height:240px;overflow:auto}
.dsu-root{display:flex;flex-direction:column;gap:2px;padding:4px 8px 2px}
.dsu-head{display:flex;align-items:center;gap:8px;padding:0 0 2px}
.dsu-title{flex:1;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsu-refresh{border:none;background:0 0;color:var(--dsw-alias-label-caption);font-size:11px;cursor:pointer;padding:2px 6px;border-radius:6px}
.dsu-refresh:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsu-refresh:disabled{cursor:default;opacity:.5}
.dsu-section{padding:6px 0;border-top:1px solid var(--dsw-alias-border-l3)}
.dsu-section:first-of-type{border-top:none}
.dsu-provider{display:flex;align-items:baseline;gap:6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsu-account{font-weight:400;color:var(--dsw-alias-label-caption);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsu-plan{margin-top:2px;font-size:11px;color:var(--dsw-alias-label-caption)}
.dsu-window{margin-top:6px}
.dsu-windowHead{display:flex;align-items:baseline;gap:6px;font-size:12px;line-height:16px}
.dsu-windowLabel{flex:1;color:var(--dsw-alias-label-secondary)}
.dsu-windowValue{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-weight:600}
.dsu-track{margin-top:3px;height:5px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);overflow:hidden}
.dsu-fill{height:100%;border-radius:999px;transition:width .2s ease-out}
.dsu-meta{margin-top:2px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-caption)}
.dsu-error{margin-top:4px;font-size:11px;line-height:15px;color:var(--dsw-alias-state-error-primary)}
.dsu-muted{font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption);padding:2px 0}
.ths-triggerEffortRunnerUp{color:#a97bff}
.ths-triggerEffortTop{background-image:linear-gradient(90deg,#4a9eff 0%,#a97bff 25%,#ff7ac0 50%,#a97bff 75%,#4a9eff 100%);background-size:200% 100%;animation:ths-topFlow 1.5s linear infinite;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.ths-cellChevron{color:var(--dsw-alias-label-caption);flex:none;display:flex}
.ths-groups{overflow:auto;flex:1;min-height:0}
.ths-group{padding:2px 0 6px}
.ths-groupTitle{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;padding:6px 8px 2px}
.ths-option{width:100%;border:none;background:0 0;color:inherit;font:inherit;text-align:left;border-radius:8px;align-items:flex-start;gap:8px;min-height:36px;padding:6px 8px;font-size:13px;line-height:20px;display:flex;cursor:pointer}
.ths-option:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.ths-option:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:-2px}
.ths-option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.ths-optionCopy{flex:1;min-width:0;flex-direction:column;display:flex}
.ths-modelName{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.ths-description{color:var(--dsw-alias-label-caption);font-size:12px;line-height:16px}
.ths-check{color:var(--dsw-alias-brand-primary);flex:none;display:flex;align-items:center}
.ths-sliderPane{flex-direction:column;gap:8px;padding:10px 20px 14px;display:flex}
.ths-sliderHeader{align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);display:flex}
.ths-back{width:24px;height:24px;border:none;background:0 0;color:var(--dsw-alias-label-secondary);border-radius:6px;cursor:pointer;align-items:center;justify-content:center;display:flex;flex:none}
.ths-back:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ths-back:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:-2px}
.ths-sliderValue{margin-left:auto;color:var(--dsw-alias-label-caption);font-size:12px;font-weight:400;background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;padding:2px 8px}
.ths-meaning{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary);margin:-2px 0 0}
.ths-customSlider{position:relative;width:100%;height:24px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);margin:14px 0 4px;flex:none}
.ths-fill{position:absolute;top:0;left:0;height:100%;width:0;background:#4a9eff;border-radius:999px;z-index:1;transition:width .15s ease-out}
.ths-dots{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2}
.ths-dot{position:absolute;top:50%;width:8px;height:8px;border-radius:50%;background:rgba(150,150,150,.45);transform:translate(-50%,-50%);transition:background .15s ease-out}
.ths-dotActive{background:rgba(255,255,255,.85)}
.ths-range{position:absolute;top:0;left:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;z-index:4;-webkit-appearance:none;appearance:none}
.ths-range:disabled{cursor:default}
.ths-range:disabled ~ .ths-fill,.ths-range:disabled ~ .ths-thumb{opacity:.5}
.ths-thumb{position:absolute;top:50%;left:0;width:32px;height:32px;background:#fff;border:1px solid rgba(0,0,0,.06);border-radius:50%;transform:translate(0,-50%);box-shadow:0 2px 10px rgba(0,0,0,.12),0 1px 3px rgba(0,0,0,.08);pointer-events:none;z-index:5;transition:left .15s ease-out}
.ths-thumb.ths-snapped{animation:ths-snap .32s cubic-bezier(.34,1.56,.64,1)}
@keyframes ths-snap{0%{transform:translate(0,-50%) scale(1)}35%{transform:translate(0,-50%) scale(1.06)}65%{transform:translate(0,-50%) scale(.98)}100%{transform:translate(0,-50%) scale(1)}}
@media (prefers-reduced-motion:reduce){.ths-thumb.ths-snapped{animation:none}}
.ths-ticks{position:relative;height:18px;margin-top:0}
.ths-tick{position:absolute;top:0;border:none;background:0 0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;padding:1px 4px;cursor:pointer;border-radius:6px;max-width:45%;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.ths-tick:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}
.ths-tickActive{color:#4a9eff;font-weight:600}
.ths-tick:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:-2px}
.ths-sliderMeta{flex-direction:column;gap:2px;display:flex}
.ths-sliderDesc{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary)}
/* Palindromic gradient in a 200%-wide tile: both tile edges are the same blue,
   so translating exactly one tile wraps seamlessly with no colour snap — pink
   flows back through purple into blue continuously. Position runs 200% -> 0% so
   the colour travels left-to-right; the wrap stays seamless either way. */
.ths-fillTop{background-image:linear-gradient(90deg,#4a9eff 0%,#a97bff 25%,#ff7ac0 50%,#a97bff 75%,#4a9eff 100%);background-size:200% 100%;animation:ths-topFlow 1.5s linear infinite}
@keyframes ths-topFlow{0%{background-position:200% 50%}100%{background-position:0% 50%}}
/* One below the top gear: steady purple, the last step before the rainbow. */
.ths-fillRunnerUp{background:#a97bff}
.ths-thumbRunnerUp{box-shadow:0 0 0 1px rgba(0,0,0,.06),0 2px 10px rgba(0,0,0,.12),0 0 12px rgba(169,123,255,.55)}
.ths-thumbTop{box-shadow:0 0 0 1px rgba(0,0,0,.06),0 2px 10px rgba(0,0,0,.12),0 0 14px rgba(150,130,255,.6);animation:ths-topGlow 1.05s ease-in-out infinite}
@keyframes ths-topGlow{0%,100%{box-shadow:0 0 0 1px rgba(0,0,0,.06),0 2px 10px rgba(0,0,0,.12),0 0 9px rgba(150,130,255,.45)}50%{box-shadow:0 0 0 1px rgba(0,0,0,.06),0 2px 10px rgba(0,0,0,.12),0 0 26px rgba(190,140,255,1)}}
.ths-topSweep{position:absolute;top:0;left:0;height:100%;width:30%;pointer-events:none;z-index:3;border-radius:999px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.75),transparent);animation:ths-topSweepRun 1.15s cubic-bezier(.55,0,.85,.3) infinite}
@keyframes ths-topSweepRun{0%{transform:translateX(-140%);opacity:0}10%{opacity:1}90%{opacity:1}100%{transform:translateX(400%);opacity:0}}
.ths-sliderPane.ths-paneResting{box-shadow:inset 0 0 14px 0 rgba(120,150,255,.14)}
.ths-slider.ths-dragging .ths-fill,.ths-slider.ths-dragging .ths-thumb{transition:none}
.ths-burst{position:absolute;top:50%;width:26px;height:26px;border-radius:50%;pointer-events:none;z-index:3;transform:translate(-50%,-50%);background:radial-gradient(circle,rgba(255,255,255,.95) 0%,rgba(150,140,255,.55) 45%,rgba(90,160,255,0) 72%);animation:ths-burst .8s cubic-bezier(.2,.7,.3,1) forwards}
@keyframes ths-burst{0%{opacity:0;transform:translate(-50%,-50%) scale(.3)}25%{opacity:1;transform:translate(-50%,-50%) scale(1.15)}100%{opacity:0;transform:translate(-50%,-50%) scale(2.6)}}
.ths-burstRing{position:absolute;top:50%;width:26px;height:26px;border-radius:50%;pointer-events:none;z-index:3;transform:translate(-50%,-50%);border:2px solid rgba(150,170,255,.85);animation:ths-ring .8s cubic-bezier(.2,.7,.3,1) forwards}
@keyframes ths-ring{0%{opacity:.95;width:26px;height:26px;transform:translate(-50%,-50%)}100%{opacity:0;width:150px;height:150px;transform:translate(-50%,-50%)}}
.ths-burstSweep{position:absolute;top:0;left:0;height:100%;width:40%;pointer-events:none;z-index:3;border-radius:999px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.85),transparent);animation:ths-sweep .8s ease-out forwards}
@keyframes ths-sweep{0%{opacity:0;transform:translateX(-120%)}20%{opacity:1}100%{opacity:0;transform:translateX(320%)}}
.ths-panePulse{animation:ths-paneFlash .8s ease-out}
@keyframes ths-paneFlash{0%{box-shadow:inset 0 0 0 0 rgba(120,150,255,0)}30%{box-shadow:inset 0 0 22px 0 rgba(120,150,255,.28)}100%{box-shadow:inset 0 0 0 0 rgba(120,150,255,0)}}
@media (prefers-reduced-motion:reduce){.ths-fillTop,.ths-thumbTop,.ths-panePulse,.ths-topSweep,.ths-triggerEffortTop{animation:none;box-shadow:none}.ths-burst,.ths-burstRing,.ths-burstSweep{display:none}}
`;
		const tagId = "thinking-slider/thinking-slider.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "thinking-slider";
			tag.dataset.pluginCss = tagId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region icons
		function IconChevronDown() {
			return React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, style: { display: 'block' } },
				React.createElement('path', { d: 'M4 6l4 4 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }));
		}

		function IconChevronRight() {
			return React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, style: { display: 'block' } },
				React.createElement('path', { d: 'M6 4l4 4-4 4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }));
		}

		function IconCheck() {
			return React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true, style: { display: 'block' } },
				React.createElement('path', { d: 'M3.5 8.5l3 3 6-7', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }));
		}
		//#endregion

				//#region usage
		/** Subscription providers surfaced by dsh-plugin-subscriptions, in display order. */
		const USAGE_PROVIDERS = [
			{ id: 'codex', name: 'ChatGPT / Codex' },
			{ id: 'claude', name: 'Claude' },
			{ id: 'grok', name: 'Grok' },
			{ id: 'copilot', name: 'GitHub Copilot' },
			{ id: 'antigravity', name: 'Google Antigravity' }
		];

		/** Shared `/api` channel + endpoint prefix the subscriptions node half mounts. */
		const USAGE_RPC_CHANNEL = '/api';
		const USAGE_RPC_PREFIX = 'subscriptions-auth.';

		/** Read one `subscriptions-auth` endpoint and unwrap the business value. */
		async function callUsageRpc(rpc, endpoint, payload) {
			const result = await rpc.call(USAGE_RPC_CHANNEL, USAGE_RPC_PREFIX + endpoint, payload || {});
			if (!result || result.ok !== true) {
				const message = result && result.error && result.error.message ? result.error.message : 'unknown error';
				throw new Error(message);
			}
			return result.value;
		}

		/** Human text of an unknown thrown value. */
		function usageMessageOf(error) {
			if (error === null || error === undefined) return 'unknown error';
			if (typeof error === 'string') return error;
			if (typeof error.message === 'string') return error.message;
			return String(error);
		}

		/** Bar colour by consumption, mirroring the subscriptions plugin's thresholds. */
		function usageBarColor(usedPercent) {
			if (usedPercent >= 95) return 'var(--dsw-alias-state-error-primary, #e5484d)';
			if (usedPercent >= 80) return 'var(--dsw-alias-state-warn-label, #f5a524)';
			return 'var(--dsw-alias-state-success-primary, #30a46c)';
		}

		/** Compact duration until a reset instant. */
		function usageDelay(t, resetsAt) {
			const ms = resetsAt - Date.now();
			if (!Number.isFinite(ms) || ms <= 0) return t('usage.now');
			const minutes = Math.floor(ms / 60000);
			const days = Math.floor(minutes / 1440);
			const hours = Math.floor((minutes % 1440) / 60);
			const mins = minutes % 60;
			if (days > 0) return days + 'd ' + hours + 'h';
			if (hours > 0) return hours + 'h ' + mins + 'm';
			return Math.max(1, mins) + 'm';
		}

		/** Label of one usage window, honouring the provider's model scope. */
		function usageWindowLabel(t, window) {
			const base = window.kind === 'session' ? t('usage.windowSession') : window.kind === 'weekly' ? t('usage.windowWeekly') : t('usage.windowOther');
			return window.scope ? base + ' · ' + window.scope : base;
		}

		/** Whether the status answer contains at least one logged-in account. */
		function usageAccountCount(statusValue) {
			const providers = statusValue && statusValue.providers ? statusValue.providers : {};
			let count = 0;
			for (const provider of USAGE_PROVIDERS) {
				const entry = providers[provider.id];
				if (entry && Array.isArray(entry.accounts)) count += entry.accounts.length;
			}
			return count;
		}

		/**
		 * Subscription usage block rendered inside the model menu, below the model
		 * and thinking-strength rows. Renders nothing unless at least one
		 * subscription account is logged in.
		 */
		function UsageSection(props) {
			const { rpc, t } = props;
			const [probe, setProbe] = React.useState('loading');
			const [rows, setRows] = React.useState([]);
			const [loading, setLoading] = React.useState(false);
			const [error, setError] = React.useState(undefined);
			const sequence = React.useRef(0);

			const load = React.useCallback(async (force) => {
				const token = ++sequence.current;
				setLoading(true);
				setError(undefined);
				try {
					const statusValue = await callUsageRpc(rpc, 'status', {});
					const providers = statusValue && statusValue.providers ? statusValue.providers : {};
					const next = [];
					for (const provider of USAGE_PROVIDERS) {
						const entry = providers[provider.id];
						const accounts = entry && Array.isArray(entry.accounts) ? entry.accounts : [];
						for (const account of accounts) {
							let usage;
							let failure;
							try {
								usage = await callUsageRpc(rpc, 'usage', {
									provider: provider.id,
									account: account.key,
									...(force ? { force: true } : {})
								});
							} catch (cause) {
								failure = usageMessageOf(cause);
							}
							next.push({ provider, account, usage, failure });
						}
					}
					if (token === sequence.current) {
						setRows(next);
						setProbe(next.length > 0 ? 'yes' : 'no');
					}
				} catch (cause) {
					if (token === sequence.current) {
						setRows([]);
						setError(usageMessageOf(cause));
					}
				} finally {
					if (token === sequence.current) setLoading(false);
				}
			}, [rpc]);

			React.useEffect(() => {
				let alive = true;
				(async () => {
					try {
						const statusValue = await callUsageRpc(rpc, 'status', {});
						if (alive) {
							const count = usageAccountCount(statusValue);
							setProbe(count > 0 ? 'yes' : 'no');
							if (count > 0) void load(false);
						}
					} catch {
						if (alive) setProbe('no');
					}
				})();
				return () => { alive = false; };
			}, [rpc, load]);

			if (probe !== 'yes') return null;

			const children = [
				React.createElement('div', { key: 'head', className: 'dsu-head' }, [
					React.createElement('span', { key: 'title', className: 'dsu-title' }, t('usage.title')),
					React.createElement('button', {
						key: 'refresh',
						type: 'button',
						className: 'dsu-refresh',
						disabled: loading,
						onClick: () => { void load(true); }
					}, t('usage.refresh'))
				])
			];

			if (error !== undefined) {
				children.push(React.createElement('div', { key: 'error', className: 'dsu-section' }, [
					React.createElement('div', { key: 'm', className: 'dsu-error' }, t('usage.error', { message: error })),
					React.createElement('div', { key: 'h', className: 'dsu-muted' }, t('usage.missing'))
				]));
			} else if (loading && rows.length === 0) {
				children.push(React.createElement('div', { key: 'loading', className: 'dsu-section dsu-muted' }, t('usage.loading')));
			} else if (rows.length === 0) {
				children.push(React.createElement('div', { key: 'empty', className: 'dsu-section dsu-muted' }, t('usage.empty')));
			} else {
				rows.forEach((row, index) => {
					const section = [
						React.createElement('div', { key: 'p', className: 'dsu-provider' }, [
							React.createElement('span', { key: 'name' }, row.provider.name),
							React.createElement('span', { key: 'acct', className: 'dsu-account' }, row.account.account || row.account.key)
						])
					];
					if (row.usage && row.usage.plan) {
						section.push(React.createElement('div', { key: 'plan', className: 'dsu-plan' }, t('usage.plan', { plan: row.usage.plan })));
					}
					if (row.failure !== undefined) {
						section.push(React.createElement('div', { key: 'err', className: 'dsu-error' }, t('usage.error', { message: row.failure })));
					} else if (row.usage && row.usage.supported === false) {
						section.push(React.createElement('div', { key: 'unsupported', className: 'dsu-muted' }, t('usage.unsupported')));
					} else if (row.usage && Array.isArray(row.usage.windows)) {
						row.usage.windows.forEach((window, windowIndex) => {
							const percent = Math.min(100, Math.max(0, Number(window.usedPercent) || 0));
							section.push(React.createElement('div', { key: 'w' + windowIndex, className: 'dsu-window' }, [
								React.createElement('div', { key: 'head', className: 'dsu-windowHead' }, [
									React.createElement('span', { key: 'label', className: 'dsu-windowLabel' }, usageWindowLabel(t, window)),
									React.createElement('span', { key: 'value', className: 'dsu-windowValue' }, Math.round(percent) + '%')
								]),
								React.createElement('div', { key: 'track', className: 'dsu-track' },
									React.createElement('div', {
										className: 'dsu-fill',
										style: { width: percent + '%', background: usageBarColor(percent) }
									})
								),
								window.resetsAt !== undefined
									? React.createElement('div', { key: 'meta', className: 'dsu-meta' }, t('usage.resetsIn', { time: usageDelay(t, window.resetsAt) }))
									: null
							]));
						});
					}
					if (row.usage && Array.isArray(row.usage.resetCredits) && row.usage.resetCredits.length > 0) {
						section.push(React.createElement('div', { key: 'credits', className: 'dsu-meta' }, t('usage.resetCredits', { count: row.usage.resetCredits.length })));
					}
					children.push(React.createElement('div', { key: 'row' + index, className: 'dsu-section' }, section));
				});
			}

			return React.createElement('div', { className: 'dsu-root' }, children);
		}
		//#endregion


		//#region ModelSeatSlider
		function ModelSeatSlider(props) {
			const { locked, available, directory, load, select, t, rpc } = props;
			// 官方模型标签（1017 徽标）注册在子 slot 上；替换座位后由我们代为渲染。
			const renderSlot = typeof props.renderSlot === 'function' ? props.renderSlot : undefined;
			const state = React.useSyncExternalStore((fn) => directory.subscribe(fn), () => directory.getSnapshot());
			const [open, setOpen] = React.useState(false);
			const [pane, setPane] = React.useState('root');
			const [draft, setDraft] = React.useState(null);
			const [pending, setPending] = React.useState(null);
			const [dragging, setDragging] = React.useState(false);
			const [selectError, setSelectError] = React.useState(null);
			const [thumbWidth, setThumbWidth] = React.useState(32);
			const [trackWidth, setTrackWidth] = React.useState(240);
			const [maxPulse, setMaxPulse] = React.useState(0);
			const [pulsing, setPulsing] = React.useState(false);
			const pulseTimerRef = React.useRef(null);
			const lastActionRef = React.useRef('load');
			const draftRef = React.useRef(null);
			const commitSeqRef = React.useRef(0);
			const rootRef = React.useRef(null);
			const triggerRef = React.useRef(null);
			const rangeRef = React.useRef(null);
			const sliderRef = React.useRef(null);
			const thumbRef = React.useRef(null);
			const itemRefs = React.useRef([]);
			const id = React.useId();

			const choices = React.useMemo(() => state.groups.flatMap((group) => group.models.map((model) => ({
				group,
				model,
				selection: {
					provider: group.id,
					model: model.id,
					...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort })
				}
			}))), [state.groups]);

			const currentChoice = state.current === null ? undefined : choices.find((c) => c.selection.provider === state.current.provider && c.selection.model === state.current.model);
			const reasoning = currentChoice?.model.reasoning;
			// Built-in fallback levels for providers that do not expose a reasoning catalog
			// (e.g. custom providers): try upstream first, fall back to a sensible default set.
			const fallbackEfforts = [
				{ id: 'low', name: 'Low' },
				{ id: 'medium', name: 'Medium' },
				{ id: 'high', name: 'High' },
				{ id: 'max', name: 'Max' },
				{ id: 'xhigh', name: 'X-High' }
			];
			const effortChoices = React.useMemo(() => {
				// Upstream reasoning catalog wins when the adapter exposes one.
				if (reasoning !== undefined && reasoning.efforts.length > 0) {
					const real = reasoning.efforts.map((effort) => ({ key: 'effort:' + effort.id, effort: effort.id, label: effort.name, ...(effort.description === undefined ? {} : { description: effort.description }) }));
					// Auto-hide the "Default" placeholder when the model already exposes enough
					// concrete levels — Default would just crowd the slider without adding value.
					if (reasoning.defaultEffort === undefined && real.length < 5) {
						return [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }, ...real];
					}
					return real;
				}
				// No upstream reasoning catalog (custom provider): use the built-in default set.
				return fallbackEfforts.map((effort) => ({ key: 'fallback:' + effort.id, effort: effort.id, label: effort.name }));
			}, [reasoning, t]);
			const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;
			const effortLabel = effectiveEffort === undefined ? (effortChoices[0]?.label ?? undefined) : (effortChoices.find((c) => c.effort === effectiveEffort)?.label ?? effectiveEffort);

			const count = effortChoices.length;
			const stepCenters = React.useMemo(() => {
				const arr = [];
				for (let i = 0; i < count; i++) arr.push(i * (100 / (count - 1 || 1)));
				return arr;
			}, [count]);
			const snapToStep = (percent) => {
				let nearest = 0;
				let minDist = Math.abs(percent - stepCenters[0]);
				for (let i = 1; i < count; i++) {
					const dist = Math.abs(percent - stepCenters[i]);
					if (dist < minDist) { minDist = dist; nearest = i; }
				}
				return { index: nearest, center: stepCenters[nearest] };
			};

			const busy = state.status === 'selecting';
			const effectiveIndex = count === 0 ? 0 : (() => {
				const idx = effortChoices.findIndex((c) => c.effort === effectiveEffort);
				return idx < 0 ? 0 : idx;
			})();
			const activeIndex = pending !== null ? pending : effectiveIndex;
			const shownPct = draft !== null ? draft : stepCenters[activeIndex] ?? 0;
			const currentEffort = count === 0 ? undefined : effortChoices[activeIndex];
			// "Top gear" = the highest level this model actually offers, which is
			// not always literally "max" (some catalogs stop at high/xhigh).
			const topIndex = count - 1;
			const atTop = count > 0 && topIndex > 0 && activeIndex === topIndex;
			const atRunnerUp = count > 0 && topIndex > 1 && activeIndex === topIndex - 1;
			const fillClass = atTop ? ' ths-fillTop' : atRunnerUp ? ' ths-fillRunnerUp' : '';
			const thumbClass = atTop ? ' ths-thumbTop' : atRunnerUp ? ' ths-thumbRunnerUp' : '';
			// 强度字样跟随档位：次顶紫、最高走流动渐变，其余保持蓝色。
			const effortClass = atTop ? ' ths-triggerEffortTop' : atRunnerUp ? ' ths-triggerEffortRunnerUp' : '';
			const modelLabel = currentChoice?.model.name ?? t('trigger.fallback');
			const shownEffortLabel = currentEffort !== undefined ? currentEffort.label : effortLabel;
			const triggerLabel = shownEffortLabel === undefined ? modelLabel : modelLabel + ' · ' + shownEffortLabel;
			const triggerAria = currentChoice === undefined ? t('trigger.selectAria') : shownEffortLabel === undefined ? t('trigger.aria', { model: modelLabel }) : t('trigger.ariaEffort', { model: modelLabel, effort: shownEffortLabel });

			// 渲染官方 `conversation.input.model.label` 子 slot；拿不到渲染器时，
			// 用与官方包一致的判定内联画出 1017 徽标，保证标签始终可见。
			const renderModelLabel = (group, model, placement, selected) => {
				const fallback = model?.name ?? '';
				if (renderSlot !== undefined) {
					try {
						const slotted = renderSlot('conversation.input.model.label', {
							provider: { id: group.id, name: group.name },
							model,
							placement,
							selected
						}, { fallback });
						if (slotted !== undefined && slotted !== null && typeof slotted !== 'string') return slotted;
					} catch {
						// 子 slot 不可用也不能让模型座位崩掉。
					}
				}
				const official = group.id === 'deepseek-official' || group.id === 'deepseek-account';
				if (official && model.id === 'deepseek-flash' && model.name === 'DeepSeek-V4.1-Flash') {
					return React.createElement(React.Fragment, null,
						model.name,
						React.createElement('span', { className: 'ths-releaseBadge' }, '1017'));
				}
				return fallback;
			};

			React.useEffect(() => {
				if (available) {
					lastActionRef.current = 'load';
					load();
				}
			}, [available, load]);

			React.useEffect(() => {
				if (!open) return;
				const closeOutside = (event) => {
					if (!rootRef.current?.contains(event.target)) setOpen(false);
				};
				document.addEventListener('mousedown', closeOutside);
				return () => document.removeEventListener('mousedown', closeOutside);
			}, [open]);

			React.useEffect(() => {
				const measure = () => {
					if (thumbRef.current !== null) setThumbWidth(thumbRef.current.offsetWidth || 32);
					if (sliderRef.current !== null) setTrackWidth(sliderRef.current.offsetWidth || 240);
				};
				measure();
				window.addEventListener('resize', measure);
				return () => window.removeEventListener('resize', measure);
			}, [open, pane]);

			React.useEffect(() => {
				if (pending === null) return;
				const choice = effortChoices[pending];
				if (choice === undefined || choice.effort !== effectiveEffort) return;
				setPending(null);
			}, [pending, effortChoices, effectiveEffort]);

			React.useEffect(() => {
				if (draftRef.current !== null) return;
				if (rangeRef.current !== null) rangeRef.current.value = String(shownPct);
			}, [shownPct]);

			React.useEffect(() => () => {
				if (pulseTimerRef.current !== null) clearTimeout(pulseTimerRef.current);
			}, []);

			if (!available) return null;

			const show = () => {
				setPane('root');
				setSelectError(null);
				setOpen(true);
				lastActionRef.current = 'load';
				load();
			};
			const close = (restoreFocus) => {
				setOpen(false);
				setPane('root');
				setDraft(null);
				setPending(null);
				setSelectError(null);
				setDragging(false);
				draftRef.current = null;
				if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
			};
			const moveFocus = (offset) => {
				const items = itemRefs.current.filter((item) => item !== null);
				if (items.length === 0) return;
				const active = items.findIndex((item) => item === document.activeElement);
				items[(Math.max(active, 0) + offset + items.length) % items.length]?.focus();
			};
			const onRootKeyDown = (event) => {
				if (event.key === 'Escape' && open) {
					event.preventDefault();
					if (pane !== 'root') setPane('root');
					else close(true);
					return;
				}
				if (!open) return;
				if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
					if (rangeRef.current !== null && event.target === rangeRef.current) return;
					event.preventDefault();
					moveFocus(event.key === 'ArrowDown' ? 1 : -1);
				}
			};
			const onBlur = (event) => {
				if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return;
				close();
			};
			const settleSelection = (accepted) => {
				if (accepted) {
					if (rootRef.current !== null) close(true);
					return;
				}
				const message = directory.getSnapshot().error;
				if (message !== null) setSelectError(message);
			};
			const choose = (selection) => {
				if (state.current?.provider === selection.provider && state.current.model === selection.model) {
					close(true);
					return;
				}
				lastActionRef.current = 'select';
				select(selection).then(settleSelection);
			};
			const triggerSnap = () => {
				const el = thumbRef.current;
				if (el === null) return;
				el.classList.remove('ths-snapped');
				void el.offsetWidth;
				el.classList.add('ths-snapped');
			};
			// Celebration for landing on the top gear. Purely cosmetic: the host
			// stays the only source of truth for the committed selection.
			const celebrateTop = () => {
				setMaxPulse((n) => n + 1);
				setPulsing(true);
				if (pulseTimerRef.current !== null) clearTimeout(pulseTimerRef.current);
				pulseTimerRef.current = setTimeout(() => setPulsing(false), 800);
			};
			const commitAt = (index) => {
				const choice = effortChoices[index];
				if (choice === undefined) return;
				if (state.current === null) return;
				if (choice.effort === effectiveEffort) return;
				const seq = ++commitSeqRef.current;
				setPending(index);
				lastActionRef.current = 'select';
				select({
					provider: state.current.provider,
					model: state.current.model,
					...(choice.effort === undefined ? {} : { reasoningEffort: choice.effort })
				}).then((accepted) => {
					if (commitSeqRef.current !== seq) return;
					if (accepted) {
						setSelectError(null);
						if (choice.effort !== undefined && index === topIndex) celebrateTop();
					} else {
						setPending(null);
						setDraft(null);
						draftRef.current = null;
						const message = directory.getSnapshot().error;
						if (message !== null) setSelectError(message);
					}
				});
			};
			const commitPct = () => {
				const pct = draftRef.current;
				if (pct === null) return;
				const { index, center } = snapToStep(pct);
				setDraft(center);
				setDragging(false);
				commitAt(index);
				triggerSnap();
			};
			const jumpTo = (index) => {
				setSelectError(null);
				const center = stepCenters[index];
				setDraft(center);
				draftRef.current = center;
				commitAt(index);
				triggerSnap();
			};
			const tickStyle = (index) => {
				if (count <= 1) return { left: '0%', transform: 'none' };
				if (index === 0) return { left: '0%', transform: 'none' };
				if (index === count - 1) return { left: '100%', transform: 'translateX(-100%)' };
				return { left: (index / (count - 1)) * 100 + '%', transform: 'translateX(-50%)' };
			};

			itemRefs.current = [];
			let itemIndex = 0;
			const itemRef = () => {
				const at = itemIndex++;
				return (node) => { itemRefs.current[at] = node; };
			};

			const reload = () => {
				lastActionRef.current = 'load';
				load();
			};
			const paneError = selectError !== null ? selectError : (state.error !== null && lastActionRef.current === 'load' ? state.error : null);

			// Track width comes from measured state: reading sliderRef.offsetWidth during
			// render forced a synchronous layout on every pointermove.
			const snappedPct = draft !== null ? draft : stepCenters[activeIndex] ?? 0;
			const thumbCenterPx = (snappedPct / 100) * trackWidth;
			const offset = thumbCenterPx - thumbWidth / 2;
			const fillWidthPx = snappedPct;

			return React.createElement('div', {
				ref: rootRef,
				className: 'ths-root',
				onKeyDown: onRootKeyDown,
				onBlur
			}, [
				React.createElement('button', {
					key: 'trigger',
					ref: triggerRef,
					type: 'button',
					className: 'ths-trigger',
					'aria-label': triggerAria,
					'aria-haspopup': 'menu',
					'aria-expanded': open,
					'aria-controls': open ? id + '-menu' : undefined,
					title: triggerLabel,
					disabled: locked,
					onClick: () => { if (open) close(); else show(); }
				}, [
					React.createElement('span', { key: 'label', className: 'ths-triggerLabel' }, currentChoice !== undefined ? renderModelLabel(currentChoice.group, currentChoice.model, 'trigger', true) : modelLabel),
					shownEffortLabel !== undefined && React.createElement('span', { key: 'effort', className: 'ths-triggerEffort' + effortClass }, shownEffortLabel),
					React.createElement('span', { key: 'chevron', className: 'ths-chevron' + (open ? ' ths-chevronOpen' : '') }, React.createElement(IconChevronDown, {}))
				]),
				open && React.createElement('div', {
					key: 'menu',
					id: id + '-menu',
					className: 'ths-menu',
					role: 'menu',
					'aria-label': t('menu.aria'),
					'aria-busy': state.status === 'loading' || busy
				}, [
					pane === 'root' && React.createElement(React.Fragment, { key: 'root' }, [
						React.createElement('button', {
							key: 'model',
							ref: itemRef(),
							type: 'button',
							role: 'menuitem',
							className: 'ths-cell',
							onClick: () => setPane('model')
						}, [
							React.createElement('span', { key: 'l', className: 'ths-cellLabel' }, t('menu.model')),
							React.createElement('span', { key: 'v', className: 'ths-cellValue' }, currentChoice !== undefined ? renderModelLabel(currentChoice.group, currentChoice.model, 'menu', true) : modelLabel),
							React.createElement('span', { key: 'c', className: 'ths-cellChevron' }, React.createElement(IconChevronRight, {}))
						]),
						effortChoices.length > 0 && React.createElement('button', {
							key: 'effort',
							ref: itemRef(),
							type: 'button',
							role: 'menuitem',
							className: 'ths-cell',
							onClick: () => { setSelectError(null); setPane('effort'); }
						}, [
							React.createElement('span', { key: 'l', className: 'ths-cellLabel' }, t('menu.effort')),
							React.createElement('span', { key: 'v', className: 'ths-cellValue ths-cellValueAccent' + effortClass }, shownEffortLabel),
							React.createElement('span', { key: 'c', className: 'ths-cellChevron' }, React.createElement(IconChevronRight, {}))
						]),
						rpc !== undefined && React.createElement('div', { key: 'usage', className: 'ths-usageSlot' }, React.createElement(UsageSection, { rpc, t }))
					]),
					pane === 'model' && React.createElement(React.Fragment, { key: 'model' }, [
						state.status === 'loading' && React.createElement('div', { key: 'loading', className: 'ths-status' }, t('status.loading')),
						paneError !== null && React.createElement('div', { key: 'error', className: 'ths-error' }, [
							React.createElement('span', { key: 'm' }, t('error.action', { message: paneError })),
							lastActionRef.current === 'load' && React.createElement('button', { key: 'r', type: 'button', className: 'ths-retry', onClick: reload }, t('action.reload'))
						]),
						state.failures.map((failure) => React.createElement('div', { key: 'f:' + failure.id, className: 'ths-error ths-warning' }, [
							React.createElement('span', { key: 'm' }, t('warning.groupLoad', { name: failure.name, message: failure.message })),
							React.createElement('button', { key: 'r', type: 'button', className: 'ths-retry', onClick: reload }, t('action.reload'))
						])),
						React.createElement('div', { key: 'groups', className: 'ths-groups scrollable' }, state.groups.map((group) => {
							const headingId = id + '-' + group.id;
							return React.createElement('section', { key: group.id, role: 'group', 'aria-labelledby': headingId, className: 'ths-group' }, [
								React.createElement('div', { key: 'h', className: 'ths-groupTitle', id: headingId }, group.name),
								group.models.map((model) => {
									const selected = state.current?.provider === group.id && state.current.model === model.id;
									return React.createElement('button', {
										key: model.id,
										ref: itemRef(),
										type: 'button',
										role: 'menuitemradio',
										'aria-checked': selected,
										className: 'ths-option' + (selected ? ' ths-selected' : ''),
										title: model.name,
										disabled: busy,
										onClick: () => choose({ provider: group.id, model: model.id })
									}, [
										React.createElement('span', { key: 'copy', className: 'ths-optionCopy' }, [
											React.createElement('span', { key: 'n', className: 'ths-modelName' }, renderModelLabel(group, model, 'option', selected)),
											model.description !== undefined && React.createElement('span', { key: 'd', className: 'ths-description' }, model.description)
										]),
										React.createElement('span', { key: 'check', className: 'ths-check' }, selected ? React.createElement(IconCheck, {}) : null)
									]);
								})
							]);
						})),
						state.status === 'ready' && choices.length === 0 && React.createElement('div', { key: 'empty', className: 'ths-empty' }, t('empty.models'))
					]),
					pane === 'effort' && React.createElement('div', { key: 'effort', className: 'ths-sliderPane' + (pulsing ? ' ths-panePulse' : '') + (atTop && !pulsing ? ' ths-paneResting' : '') }, [
						React.createElement('div', { key: 'header', className: 'ths-sliderHeader' }, [
							React.createElement('button', {
								key: 'back',
								ref: itemRef(),
								type: 'button',
								className: 'ths-back',
								'aria-label': t('back.label'),
								onClick: () => { setSelectError(null); setPane('root'); }
							}, React.createElement(IconChevronDown, {})),
							React.createElement('span', { key: 'title' }, t('menu.effort')),
							React.createElement('span', { key: 'value', className: 'ths-sliderValue' }, currentEffort?.label ?? '')
						]),
						React.createElement('div', { key: 'meaning', className: 'ths-meaning' }, t('desc.meaning')),
						paneError !== null && React.createElement('div', { key: 'error', className: 'ths-error' }, [
							React.createElement('span', { key: 'm' }, t('error.action', { message: paneError })),
							React.createElement('button', { key: 'r', type: 'button', className: 'ths-retry', onClick: () => setSelectError(null) }, t('action.reload'))
						]),
						count === 0 ? React.createElement('div', { key: 'empty', className: 'ths-empty' }, t('empty.efforts')) : [
							React.createElement('div', { key: 'slider', ref: sliderRef, className: 'ths-customSlider ths-slider' + (dragging ? ' ths-dragging' : '') }, [
								React.createElement('div', { key: 'fill', className: 'ths-fill' + fillClass, style: { width: fillWidthPx + '%' } }),
								React.createElement('div', { key: 'dots', className: 'ths-dots' }, effortChoices.map((choice, index) => {
									if (index === 0 || index === count - 1) return null;
									return React.createElement('span', { key: choice.key, className: 'ths-dot' + (index <= activeIndex ? ' ths-dotActive' : ''), style: { left: stepCenters[index] + '%' } });
								})),
								React.createElement('input', {
									key: 'range',
									ref: rangeRef,
									type: 'range',
									className: 'ths-range',
									min: 0,
									max: 100,
									step: 1,
									defaultValue: shownPct,
									disabled: locked,
									'aria-label': t('slider.aria', { effort: currentEffort?.label ?? '' }),
									'aria-valuetext': currentEffort?.label ?? '',
									onPointerDown: () => { setDragging(true); draftRef.current = Number(rangeRef.current?.value ?? shownPct); },
									onChange: (e) => {
										const v = Number(e.target.value);
										setSelectError(null);
										setDraft(v);
										draftRef.current = v;
									},
									onPointerUp: commitPct,
									onPointerCancel: commitPct,
									onKeyUp: commitPct,
									onBlur: commitPct
								}),
								React.createElement('div', { key: 'thumb', ref: thumbRef, className: 'ths-thumb' + thumbClass, style: { left: offset + 'px' }, 'aria-hidden': true }),
								pulsing && React.createElement('div', { key: 'burstSweep:' + maxPulse, className: 'ths-burstSweep', 'aria-hidden': true }),
								atTop && React.createElement('div', { key: 'topSweep', className: 'ths-topSweep', 'aria-hidden': true }),
								pulsing && React.createElement('div', { key: 'burstRing:' + maxPulse, className: 'ths-burstRing', style: { left: (offset + thumbWidth / 2) + 'px' }, 'aria-hidden': true }),
								pulsing && React.createElement('div', { key: 'burst:' + maxPulse, className: 'ths-burst', style: { left: (offset + thumbWidth / 2) + 'px' }, 'aria-hidden': true })
							]),
							React.createElement('div', { key: 'ticks', className: 'ths-ticks', role: 'presentation' }, effortChoices.map((choice, index) => React.createElement('button', {
								key: choice.key,
								ref: itemRef(),
								type: 'button',
								className: 'ths-tick' + (index === activeIndex ? ' ths-tickActive' : ''),
								style: tickStyle(index),
								onClick: () => jumpTo(index)
							}, choice.label))),
							React.createElement('div', { key: 'meta', className: 'ths-sliderMeta' }, [
								currentEffort?.description !== undefined && React.createElement('span', { key: 'd', className: 'ths-sliderDesc' }, currentEffort.description)
							])
						]
					])
				])
			]);
		}
		//#endregion

		//#region apply
		/**
		 * Services this plugin declares. The client runner wraps the context in
		 * a guarded proxy: every service it hands back may reach further
		 * context internally, and `denyContext` rejects any property the
		 * returning plugin did not declare here. `modelDirectories.directoryFor`
		 * reaches `remote` and `remote.session`, so without this the composer
		 * seat throws "cannot get property \"remote.session\" without inject"
		 * and the slot entry is dropped. The object form ({ inject, apply }) is
		 * the only declaration site — a bare function has none.
		 */
		const inject = ['connection', 'locale', 'sessions', 'slots', 'modelDirectories', 'remote', 'remote.session'];

		function apply(ctx) {
			const locale = ctx.get('locale');
			if (locale === undefined) return;
			ctx.effect(() => locale.register(NS, { zh, en }));
			const slots = ctx.get('slots');
			if (slots === undefined) return;
			const connection = ctx.get('connection');
			if (connection === undefined) return;
			const sessions = ctx.get('sessions');
			if (sessions === undefined) return;
			slots.inject('conversation.input.model', () => {
				const models = ctx.get('modelDirectories');
				if (models === undefined) return () => {};
				return slots.register({
					name: 'conversation.input.model',
					priority: -2,
					locale: NS,
					inject: (sessionId) => {
						const directory = models.directoryFor(sessionId);
						const available = sessions.subagentAddress(sessionId) === undefined;
						return {
							available,
							directory: directory.store,
							load: () => { if (available) directory.load().catch(() => {}); },
							select: (selection) => available ? directory.select(selection).then(() => true, () => false) : Promise.resolve(false),
							rpc: connection.rpc
						};
					}
				}, ModelSeatSlider);
			});
		}
		//#endregion

		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
