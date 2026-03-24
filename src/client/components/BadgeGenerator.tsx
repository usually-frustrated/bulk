import { createSignal } from 'solid-js';
import styles from './BadgeGenerator.module.css';

interface Props {
	/** Reactive accessor for the current package name. */
	pkg: () => string;
}

export function BadgeGenerator(props: Props) {
	const domain = window.location.origin;
	const [copyUrlText, setCopyUrlText] = createSignal('copy url');
	const [copyBannerText, setCopyBannerText] = createSignal('copy url');

	const badgeUrl  = () => `${domain}/${props.pkg() || 'zustand'}`;
	const bannerUrl = () => `${domain}/_banner/standard/${props.pkg() || 'zustand'}`;

	const withFlash = (setter: (s: string) => void, label: string, done: string) => async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setter(done);
			setTimeout(() => setter(label), 2000);
		} catch {}
	};

	const copyUrl    = withFlash(setCopyUrlText,    'copy url', 'copied!');
	const copyBanner = withFlash(setCopyBannerText, 'copy url', 'copied!');

	return (
		<section class={styles.badgeGenerator}>
			<label class={styles.inputLabel}>badge</label>
			<div class={styles.previewRow}>
				<div class={styles.actions}>
					<button class={styles.copyButton} onClick={() => copyUrl(badgeUrl())}>
						{copyUrlText()}
					</button>
				</div>
				<img src={badgeUrl()} alt={`${props.pkg()} size badge`} class={styles.badgeImg} />
			</div>

			<label class={styles.inputLabel} style="margin-top:0.75rem">banner</label>
			<div class={styles.previewRow}>
				<div class={styles.actions}>
					<button class={styles.copyButton} onClick={() => copyBanner(bannerUrl())}>
						{copyBannerText()}
					</button>
				</div>
				<img src={bannerUrl()} alt={`${props.pkg()} banner`} class={styles.bannerImg} />
			</div>
		</section>
	);
}
