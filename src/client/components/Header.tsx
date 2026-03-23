import styles from './Header.module.css';

export function Header() {
	return (
		<header class={styles.header}>
			<h1><img src="/_/logo.png" class={styles.logo} alt="" aria-hidden="true" /> bulk</h1>
			<p class={styles.tagline}>CDN Bundle Size Analysis</p>
			<p class={styles.tagline}>
				Measure actual runtime impact across CDNs. Compare jsDelivr, unpkg, and esm.sh bundle sizes.
			</p>
		</header>
	);
}
