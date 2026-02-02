import { createSignal } from 'solid-js';
import styles from './BadgeGenerator.module.css';

export function BadgeGenerator() {
	const domain = window.location.origin;
	const [packageName, setPackageName] = createSignal('zustand');
	const [copyText, setCopyText] = createSignal('copy badge URL');

	const badgeUrl = () => `${domain}/${packageName() || 'zustand'}`;

	const handleInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
		setPackageName(e.currentTarget.value.trim());
	};

	const handleCopy = async () => {
		const url = badgeUrl();
		try {
			await navigator.clipboard.writeText(url);
			setCopyText('copied!');
			setTimeout(() => {
				setCopyText('copy badge URL');
			}, 2000);
		} catch (err) {
			console.error('Failed to copy:', err);
		}
	};

	return (
		<section class={styles.badgeGenerator}>
			<label for="package-input" class={styles.inputLabel}>
				Package name
			</label>
			<div class={styles.inputWithButton}>
				{/*<span class={styles.inputPrefix}>{domain}/</span>*/}
				<input type="text" id="package-input" value={packageName()} onInput={handleInput} placeholder="e.g., react, zustand" />
				<button class={styles.copyButton} onClick={handleCopy}>
					{copyText()}
				</button>
			</div>
			<div class={styles.livePreview}>
				<div class={styles.badgeUrl}>
					<code>
						<pre>{badgeUrl()}</pre>
					</code>
				</div>
				<img src={badgeUrl()} alt="jsdelivr size" />
			</div>
		</section>
	);
}
