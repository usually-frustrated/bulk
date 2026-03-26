import { createSignal } from 'solid-js';
import styles from './BadgeGenerator.module.css';

interface Props {
	/** Reactive accessor for the current package name. */
	pkg: () => string;
	/** Version string from last measurement ('' if not yet measured). */
	version: () => string;
	/** CDN from last measurement. */
	cdn: () => string;
	/** Format from last measurement. */
	format: () => string;
}

export function BadgeGenerator(props: Props) {
	const domain = window.location.origin;
	const [copyUrlText, setCopyUrlText] = createSignal('copy url');
	const [copyBannerText, setCopyBannerText] = createSignal('copy url');

	// Badge URL: use measured CDN + version when available so it reflects what was measured.
	const badgeUrl = () => {
		const pkg = props.pkg() || 'zustand';
		const ver = props.version();
		const cdn = props.cdn();
		const pkgAt = ver ? `${pkg}@${ver}` : pkg;
		return cdn && cdn !== 'jsdelivr'
			? `${domain}/${cdn}/${pkgAt}`
			: `${domain}/${pkgAt}`;
	};

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
			{/* Badge */}
			<div class={styles.headingRow}>
				<label class={styles.inputLabel}>badge</label>
				<button class={styles.copyButton} onClick={() => copyUrl(badgeUrl())}>
					{copyUrlText()}
				</button>
			</div>
			<div class={styles.previewRow}>
				<img src={badgeUrl()} alt={`${props.pkg()} size badge`} class={styles.badgeImg} />
			</div>

			{/* Banner — copy URL only; live result shown above by WaterfallBanner */}
			<div class={styles.headingRow}>
				<label class={styles.inputLabel}>banner</label>
				<button class={styles.copyButton} onClick={() => copyBanner(bannerUrl())}>
					{copyBannerText()}
				</button>
			</div>
		</section>
	);
}
