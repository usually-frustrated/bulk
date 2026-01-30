import { PROVIDER_IDS } from '../providers';

export interface ParsedPath {
	provider: string;
	pkg: string;
}

export function parsePath(pathname: string): ParsedPath | null {
	const parts = pathname.slice(1).split('/').filter(Boolean);
	if (parts.length === 0) return null;

	const [first, ...rest] = parts;

	if (PROVIDER_IDS.includes(first)) {
		return rest.length > 0 ? { provider: first, pkg: rest.join('/') } : null;
	}

	return { provider: 'jsdelivr', pkg: parts.join('/') };
}

export function isImmutableVersion(pkg: string): boolean {
	return pkg.includes('@') && /\d/.test(pkg.split('@').pop() || '');
}

export function getCacheDuration(pkg: string): number {
	return isImmutableVersion(pkg) ? 31536000 : 3600;
}

export function buildCacheControl(pkg: string): string {
	const maxAge = getCacheDuration(pkg);
	const immutable = isImmutableVersion(pkg) ? ', immutable' : '';
	return `public, max-age=${maxAge}${immutable}`;
}
