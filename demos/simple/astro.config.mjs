import node from "@astrojs/node";
import react from "@astrojs/react";
import { auditLogPlugin } from "@emdash-cms/plugin-audit-log";
import { defineConfig, fontProviders } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

export default defineConfig({
	output: "server",
	adapter: node({
		mode: "standalone",
	}),
	// Example: allowed domains for reverse proxy
	// security: {
	// 	allowedDomains: [
	// 		{ hostname: "emdash.local", protocol: "http" },
	// 		{ hostname: "emdash.local", protocol: "https" },
	// 	],
	// },
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database: sqlite({ url: "file:./data.db" }),
			storage: local({
				directory: "./uploads",
				baseUrl: "/_emdash/api/media/file",
			}),
			plugins: [auditLogPlugin()],
			// HTTPS reverse proxy: uncomment so all origin-dependent features match browser
			// siteUrl: "https://emdash.local:8443",
		}),
	],
	// Blog post template uses self-hosted Gilroy + Noto Sans + DM Sans (see src/styles/theme.css).
	// JetBrains Mono is loaded via Astro fonts API below for mono labels.
	// Inter and Source Serif 4 were removed — they were preloaded on every page (~400KB) and
	// never referenced by our theme.
	fonts: [
		{
			provider: fontProviders.google(),
			name: "JetBrains Mono",
			cssVariable: "--font-mono",
			weights: [400, 500],
			fallbacks: ["ui-monospace", "SF Mono", "Menlo", "monospace"],
		},
	],
	devToolbar: { enabled: false },
	// Example: allowed hosts for reverse proxy
	// vite: {
	// 	server: {
	// 		allowedHosts: ["emdash.local"],
	// 	},
	// },
});
