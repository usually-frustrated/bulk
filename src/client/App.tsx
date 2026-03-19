import { Header } from './components/Header';
import { UsageInfo } from './components/UsageInfo';
import { BadgeGenerator } from './components/BadgeGenerator';
import { BundleHistory } from './components/BundleHistory';

export function App() {
	return (
		<main>
			<div class="hero-section">
				<Header />
				<UsageInfo />
				<BadgeGenerator />
				<BundleHistory />
			</div>
		</main>
	);
}
