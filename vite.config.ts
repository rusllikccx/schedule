import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Vite plugin that:
 * 1. During `npm run dev`: Compiles and runs the Go backend server (Windows .exe or Linux)
 *    and terminates it gracefully when dev server stops.
 * 2. During `npm run build`: Cross-compiles the Go backend for Debian Linux (`GOOS=linux GOARCH=amd64`)
 *    directly into `build/schedule-api` so the build output contains everything needed for production.
 */
function goBackendPlugin(): Plugin {
	let goProcess: ChildProcess | null = null;
	const serverDir = path.resolve('server');

	return {
		name: 'vite-plugin-go-backend',

		configureServer(server) {
			const isWin = process.platform === 'win32';
			const exeName = isWin ? 'server.exe' : 'server';
			const exePath = path.join(serverDir, exeName);

			// Ensure port 3001 is free and previous binary is unlocked before compiling
			if (isWin) {
				try {
					execSync('taskkill /IM server.exe /F', { stdio: 'ignore' });
				} catch {
					// ignore
				}
			}

			console.log('\n[Go Backend] Building local binary for development...');
			try {
				const envHost: NodeJS.ProcessEnv = { ...process.env };
				delete envHost.GOOS;
				delete envHost.GOARCH;

				execSync(`go build -o ${exeName} main.go`, {
					cwd: serverDir,
					env: envHost,
					stdio: 'inherit'
				});
			} catch (err) {
				console.warn('[Go Backend] Warning: Failed to build Go binary. Ensure Go is installed in PATH.', err);
				return;
			}

			console.log('[Go Backend] Starting server on http://127.0.0.1:3001...');
			const envHost: NodeJS.ProcessEnv = { ...process.env, DEV_MODE: '1' };
			delete envHost.GOOS;
			delete envHost.GOARCH;

			goProcess = spawn(exePath, [], {
				cwd: serverDir,
				env: envHost,
				stdio: ['pipe', 'inherit', 'inherit'],
				shell: false
			});

			goProcess.on('error', (err) => {
				console.error('[Go Backend] Process error:', err);
			});

			const cleanup = () => {
				if (goProcess) {
					console.log('\n[Go Backend] Stopping server process...');
					if (isWin) {
						try {
							execSync('taskkill /IM server.exe /F', { stdio: 'ignore' });
						} catch {
							// ignore
						}
					} else {
						try {
							goProcess.kill('SIGTERM');
						} catch {
							// ignore
						}
					}
					goProcess = null;
				}
			};

			process.on('exit', cleanup);
			process.on('SIGINT', cleanup);
			process.on('SIGTERM', cleanup);
			process.once('exit', cleanup);
			process.once('SIGINT', () => {
				cleanup();
				process.exit(0);
			});
			process.once('SIGTERM', () => {
				cleanup();
				process.exit(0);
			});
			server.httpServer?.on('close', cleanup);
		},

		closeBundle() {
			// Runs during build. Cross-compile Go binary for Debian Linux (GOOS=linux GOARCH=amd64)
			console.log('\n[Go Backend] Compiling Linux binary for Debian deployment (GOOS=linux GOARCH=amd64)...');
			try {
				const debianBinPath = path.join(serverDir, 'schedule-api');
				execSync(`go build -ldflags="-s -w" -o "${debianBinPath}" main.go`, {
					cwd: serverDir,
					env: {
						...process.env,
						GOOS: 'linux',
						GOARCH: 'amd64'
					},
					stdio: 'inherit'
				});
				console.log(`[Go Backend] Debian binary successfully created at: ${debianBinPath}\n`);

				// Also copy into build/ if directory exists
				const buildDir = path.resolve('build');
				if (fs.existsSync(buildDir)) {
					fs.copyFileSync(debianBinPath, path.join(buildDir, 'schedule-api'));
				}
			} catch (err) {
				console.warn('[Go Backend] Note: Could not cross-compile Debian binary (Go not found or build failed):', err);
			}
		}
	};
}

export default defineConfig({
	server: {
		proxy: {
			'/api': {
				target: 'http://127.0.0.1:3001',
				changeOrigin: true
			}
		}
	},
	plugins: [
		goBackendPlugin(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: '404.html',
				precompress: false,
				strict: true
			})
		})
	]
});
