import styles from './Footer.module.css';

export function Footer() {
	return (
		<footer class={`bleed-top ${styles.footer}`}>
			<div class={styles.api}>
				<span class={styles.apiLabel}>API</span>
				<div class={styles.apiRoutes}>
					<code>/:package</code>
					<code>/:package?cdn=jsdelivr|unpkg|esm.sh</code>
				</div>
			</div>
			<div class={styles.links}>
				<a href="https://github.com/usually-frustrated/bulk" target="_blank" rel="noopener noreferrer">
					github
				</a>
				<span aria-hidden="true">•</span>
				<a href="https://github.com/usually-frustrated" target="_blank" rel="noopener noreferrer">
					@usually-frustrated
				</a>
			</div>
		</footer>
	);
}
