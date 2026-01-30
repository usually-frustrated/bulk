export interface Provider {
	id: string;
	name: string;
	url: (pkg: string) => string;
}

const providers: Record<string, Provider> = {
	jsdelivr: {
		id: 'jsdelivr',
		name: 'jsDelivr',
		url: (pkg) => `https://cdn.jsdelivr.net/npm/${pkg}`,
	},
	unpkg: {
		id: 'unpkg',
		name: 'unpkg',
		url: (pkg) => `https://unpkg.com/${pkg}`,
	},
	skypack: {
		id: 'skypack',
		name: 'Skypack',
		url: (pkg) => `https://cdn.skypack.dev/${pkg}`,
	},
	esmsh: {
		id: 'esmsh',
		name: 'esm.sh',
		url: (pkg) => `https://esm.sh/${pkg}`,
	},
};

export function getProvider(id: string): Provider | null {
	return providers[id] || null;
}

export function getDefaultProvider(): Provider {
	return providers.jsdelivr;
}

export const PROVIDER_IDS = Object.keys(providers);
