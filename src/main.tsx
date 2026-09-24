import { render } from 'preact';
import '@fontsource-variable/fraunces/soft.css';
import './styles.css';
import { App } from './app';
import { ArtDefs } from './components/FoodArt';

const root = document.getElementById('app')!;
if (import.meta.env.DEV && location.hash === '#gallery') {
  import('./dev-gallery').then(({ Gallery }) => render(<><ArtDefs /><Gallery /></>, root));
} else {
  render(<App />, root);
}
