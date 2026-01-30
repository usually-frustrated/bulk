export function formatSize(bytes: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'kB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return (bytes / 1024 ** i).toFixed(1) + ' ' + units[i];
}
