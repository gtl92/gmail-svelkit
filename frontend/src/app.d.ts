// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	
	}
}// Déclare la propriété Metro sur window (pour Metro UI)
declare global {
	interface Window {
		Metro?: any;
	}
}

// 👇 Ajoute ceci tout en bas pour html2pdf.js
declare module 'html2pdf.js';

export {};
