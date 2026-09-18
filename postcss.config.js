import purgecss from '@fullhuman/postcss-purgecss';

export default (ctx) => {
	const isProd = ctx?.env === 'production' || process.env.NODE_ENV === 'production';

	return {
		plugins: [
			isProd &&
				purgecss({
					content: [
						'./src/**/*.html',
						'./src/**/*.svelte',
						'./src/**/*.ts'
					],
					defaultExtractor: (content) => {
						return content.match(/[A-Za-z0-9-_/]+/g) || [];
					},
					safelist: {
						standard: [
							'active',
							'show',
							'fade',
							'collapse',
							'collapsing',
							'btn',
							'btn-danger',
							'btn-close',
							'modal-backdrop',
							'spinner-border',
							'spinner-border-sm',
							'visually-hidden',
							'flex-fill',
							'highlight-pointed-lesson',
							'mobile-active-day',
							'current-day-cell',
							'current-day-header',
							'current-lesson-active',
							'is-hidden',
							'has-link',
							'copied',
							'time-col',
							// Dynamic classes generated at runtime
							/^btn-/,
							/^btn-group/,
							/^type-/,
							/^status-/,
							/^badge-/,
							/^progress-/,
							/^btn-outline-/,
							/^text-(primary|secondary|success|danger|warning|muted|dark|light|white|black)/,
							/^bg-(primary|secondary|success|danger|warning|light|white|dark)/,
							/^border-(primary|secondary|success|danger|warning|light|dark)?/
						],
						deep: [
							/schedule-table/,
							/lesson-card/,
							/live-status/,
							/test-panel/,
							/links-modal/,
							/modal/
						]
					}
				})
		].filter(Boolean)
	};
};
