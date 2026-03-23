import styles from './Header.module.css';

export function Header() {
	return (
		<header class={styles.header}>
			<h1><img src="/_/logo.png" class={styles.logo} alt="" aria-hidden="true" /> bulk</h1>
			<p class={styles.tagline}>CDN bundle size analysis</p>
		</header>
	);
}
