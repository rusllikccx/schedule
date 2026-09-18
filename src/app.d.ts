// See https://svelte.dev/docs/kit/types#app.d.ts

interface NetworkInformation extends EventTarget {
	readonly effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
	readonly rtt?: number;
	readonly downlink?: number;
	readonly saveData?: boolean;
}

declare global {
	interface Navigator {
		connection?: NetworkInformation;
		mozConnection?: NetworkInformation;
		webkitConnection?: NetworkInformation;
	}

	interface Window {
		__SCHEDULE_PROMISE__?: Promise<import('./lib/types').ApiScheduleResponse>;
		__toggleTestMode?: (forced?: boolean) => void;
		__DIAGNOSTICS__?: import('./lib/diagnostics').DiagnosticData;
		__printDiagnostics?: () => void;
		__exportDiagnostics?: () => string;
		test?: unknown;
		diag?: unknown;
		requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
	}

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
