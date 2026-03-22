import { Show } from 'solid-js';
import styles from './LoadingOverlay.module.css';

interface LoadingOverlayProps {
	progress?: { current: number; total: number };
}

export function LoadingOverlay(props: LoadingOverlayProps) {
	const showProgress = () => props.progress && props.progress.total > 0;
	
	return (
		<div class={styles.overlay}>
			<div class={styles.content}>
				<span class={styles.spinner} aria-hidden="true">✜</span>
				<Show when={showProgress()}>
					<div class={styles.progress}>
						{props.progress!.current} / {props.progress!.total} measurements
					</div>
				</Show>
			</div>
		</div>
	);
}
