import { Header } from './components/Header';
import { UsageInfo } from './components/UsageInfo';
import { BadgeGenerator } from './components/BadgeGenerator';

export function App() {
	return (
		<main>
			<div class="hero-section">
				<Header />
				<UsageInfo />
				<BadgeGenerator />
			</div>
		</main>
	);
}
