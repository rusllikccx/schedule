import purgecss from '@fullhuman/postcss-purgecss';

const isProd = process.env.NODE_ENV === 'production';

export default {
	plugins: [
		isProd &&
			purgecss({
				content: [
					'./src/**/*.html',
					'./src/**/*.svelte',
					'./src/**/*.ts'
				],
				defaultExtractor: (content) => {
					// Capture all class name patterns including Svelte dynamics
					return content.match(/[A-Za-z0-9-_/:]+/g) || [];
				},
				safelist: {
					standard: [
						// Dynamic classes used across Svelte components
						/^type-/,
						/^status-/,
						/^badge-/,
						/^progress-/,
						/^is-/,
						/^btn-/,
						/^col-/,
						/^border/,
						/^text-/,
						/^bg-/,
						/^form-/,
						/^input-group/,
						/^table/,
						/^modal/,
						'btn-close',
						'active',
						'show',
						'collapse',
						'collapsing',
						'highlight-pointed-lesson',
						'mobile-active-day',
						'current-day-cell',
						'current-day-header',
						'current-lesson-active',
						'is-hidden',
						'time-col'
					],
					deep: [
						/schedule-table/,
						/lesson-card/,
						/live-status/,
						/test-panel/,
						/links-modal/
					]
				}
			})
	].filter(Boolean)
};
