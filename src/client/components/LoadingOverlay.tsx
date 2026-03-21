import styles from './LoadingOverlay.module.css';

export function LoadingOverlay() {
	return (
		<div class={styles.overlay}>
			<span class={styles.spinner} aria-hidden="true">✜</span>
		</div>
	);
}
