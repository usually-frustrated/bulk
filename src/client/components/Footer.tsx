import styles from './Footer.module.css';

export function Footer() {
	return (
		<footer class={styles.footer}>
			<a href="https://github.com/sushruth" target="_blank" rel="noopener noreferrer">
				@sushruth
			</a>
			<span>•</span>
			<a href="https://github.com/sushruth/bulk" target="_blank" rel="noopener noreferrer">
				github
			</a>
		</footer>
	);
}
