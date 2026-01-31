import { createSignal } from 'solid-js';

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
		<section class="badge-generator">
			<label for="package-input" class="input-label">
				Package name
			</label>
			<div class="input-with-button">
				{/*<span class="input-prefix">{domain}/</span>*/}
				<input type="text" id="package-input" value={packageName()} onInput={handleInput} placeholder="e.g., react, zustand" />
				<button class="copy-button" onClick={handleCopy}>
					{copyText()}
				</button>
			</div>
			<div class="live-preview">
				<div class="badge-url">
					<code>
						<pre>{badgeUrl()}</pre>
					</code>
				</div>
				<img src={badgeUrl()} alt="jsdelivr size" />
			</div>
		</section>
	);
}
