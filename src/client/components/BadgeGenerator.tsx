import { createSignal } from 'solid-js';
import styles from './BadgeGenerator.module.css';

interface Props {
	pkg:     () => string;
	version: () => string;
	cdn:     () => string;
	format:  () => string;
}

export function BadgeGenerator(props: Props) {
	const domain = window.location.origin;
	const [copyUrlText, setCopyUrlText] = createSignal('copy url');

	// Badge URL: include measured CDN + version when available.
	const badgeUrl = () => {
		const pkg = props.pkg() || 'zustand';
		const ver = props.version();
		const cdn = props.cdn();
		const pkgAt = ver ? `${pkg}@${ver}` : pkg;
		return cdn && cdn !== 'jsdelivr'
			? `${domain}/${cdn}/${pkgAt}`
			: `${domain}/${pkgAt}`;
	};

	const copyUrl = async () => {
		try {
			await navigator.clipboard.writeText(badgeUrl());
			setCopyUrlText('copied!');
			setTimeout(() => setCopyUrlText('copy url'), 2000);
		} catch {}
	};

	return (
		<section class={styles.badgeGenerator}>
			<div class={styles.headingRow}>
				<label class={styles.inputLabel}>badge</label>
				<button class={styles.copyButton} onClick={copyUrl}>
					{copyUrlText()}
				</button>
			</div>
			<div class={styles.previewRow}>
				<img src={badgeUrl()} alt={`${props.pkg()} size badge`} class={styles.badgeImg} />
			</div>
		</section>
	);
}
