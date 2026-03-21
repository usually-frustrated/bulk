import styles from './LoadingOverlay.module.css';

export function LoadingOverlay() {
	return (
		<div class={styles.overlay}>
			<img src="/_/logo.png" class={styles.spinner} alt="Loading" />
		</div>
	);
}
