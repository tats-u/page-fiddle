// @ts-check
import { defineConfig } from 'astro/config';
import solid from '@astrojs/solid-js';

const isGitHubActions = !!process.env.GITHUB_ACTIONS;
const repo = process.env.GITHUB_REPOSITORY ?? '';
const repoName = repo.includes('/') ? repo.split('/')[1] : '';
const owner = process.env.GITHUB_REPOSITORY_OWNER ?? '';

export default defineConfig({
	site: isGitHubActions && owner ? `https://${owner}.github.io` : undefined,
	base: isGitHubActions && repoName ? `/${repoName}/` : undefined,
	integrations: [solid()],
});
