export function Header() {
	return (
		<header class="header">
			<h1>✜ bulk</h1>
			<p class="tagline">Package size badges</p>
			<p class="tagline">
				Shows the actual CDN bundle size - the initial load size when using CDN imports. If the CDN
				points to a bundle, this is the total bundle size. Unlike bundlephobia which shows
				minified+gzipped npm package sizes.
			</p>
		</header>
	);
}
