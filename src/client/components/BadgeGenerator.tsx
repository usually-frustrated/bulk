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
			{/* ── Badge ──────────────────────────────────────────────── */}
			<hr class={styles.separator} />
			<div class={styles.headingRow}>
				<label class={styles.inputLabel}>badge</label>
				<button class={styles.copyButton} onClick={() => copyUrl(badgeUrl())}>
					{copyUrlText()}
				</button>
			</div>
			<div class={styles.previewRow}>
				<img src={badgeUrl()} alt={`${props.pkg()} size badge`} class={styles.badgeImg} />
			</div>

			{/* ── Banner ─────────────────────────────────────────────── */}
			<hr class={styles.separator} />
			<div class={styles.headingRow}>
				<label class={styles.inputLabel}>banner</label>
				<button class={styles.copyButton} onClick={() => copyBanner(bannerUrl())}>
					{copyBannerText()}
				</button>
			</div>
			<div class={styles.previewRow}>
				<img src={bannerUrl()} alt={`${props.pkg()} banner`} class={styles.bannerImg} />
			</div>
			<hr class={styles.separator} />
		</section>
	);
}
