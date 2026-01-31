const domain = window.location.origin;
const input = document.getElementById('package-input') as HTMLInputElement;
const preview = document.getElementById('badge-preview') as HTMLImageElement;
const prefix = document.querySelector('.input-prefix') as HTMLSpanElement;
const copyButton = document.getElementById('copy-button') as HTMLButtonElement;

// Update prefix with actual domain
prefix.textContent = `${domain}/`;

// Update preview when input changes
input.addEventListener('input', function () {
	const pkg = this.value.trim() || 'zustand';
	preview.src = `${domain}/${pkg}`;
});

// Select all on click
input.addEventListener('click', function () {
	this.select();
});

// Copy URL to clipboard
copyButton.addEventListener('click', async function () {
	const pkg = input.value.trim() || 'zustand';
	const url = `${domain}/${pkg}`;

	try {
		await navigator.clipboard.writeText(url);
		copyButton.textContent = 'copied!';
		setTimeout(() => {
			copyButton.textContent = 'copy';
		}, 2000);
	} catch (err) {
		console.error('Failed to copy:', err);
	}
});
