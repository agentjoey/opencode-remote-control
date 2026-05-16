import { mount } from 'svelte'
import App from '../src/extension/App.svelte'

const app = document.getElementById('app')
if (app) {
  mount(App, { target: app })
}
