import { createSignal, createEffect } from 'solid-js';
import styles from './BadgeGenerator.module.css';

interface Props {
	/** Reactive accessor for the current package name. */
	pkg: () => string;
}

export function BadgeGenerator(props: Props) {
	const domain = window.location.origin;
	const [copyUrlText, setCopyUrlText] = createSignal('copy url');
	const [copyMdText, setCopyMdText] = createSignal('copy markdown');

	const badgeUrl = () => `${domain}/${props.pkg() || 'zustand'}`;
	const markdownEmbed = () => `[![${props.pkg() || 'zustand'} size](${badgeUrl()})](${domain}/?pkg=${encodeURIComponent(props.pkg() || 'zustand')})`;

	const withFlash = (setter: (s: string) => void, label: string, done: string) => async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setter(done);
			setTimeout(() => setter(label), 2000);
		} catch {}
	};

	const copyUrl = withFlash(setCopyUrlText, 'copy url', 'copied!');
	const copyMd  = withFlash(setCopyMdText,  'copy markdown', 'copied!');

	return (
		<section class={styles.badgeGenerator}>
			<label class={styles.inputLabel}>badge</label>
			<div class={styles.previewRow}>
				<img src={badgeUrl()} alt={`${props.pkg()} size badge`} class={styles.badgeImg} />
				<div class={styles.actions}>
					<button class={styles.copyButton} onClick={() => copyUrl(badgeUrl())}>
						{copyUrlText()}
					</button>
					<button class={styles.copyButton} onClick={() => copyMd(markdownEmbed())}>
						{copyMdText()}
					</button>
				</div>
			</div>
		</section>
	);
}
