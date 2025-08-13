<script>

  import { onMount, afterUpdate } from 'svelte';
  import "../styles/metro.css";

    onMount(() => {
        const script = document.createElement('script');
        script.src = 'https://cdn.metroui.org.ua/v4/js/metro.min.js';

        // Écoute l'événement 'load' du script pour s'assurer qu'il est entièrement chargé
        script.onload = () => {
            console.log('Script Metro 4 JS chargé avec succès.');
            // Maintenant, l'objet Metro devrait être disponible
            if (window.Metro) {
                console.log('Metro 4 JS initialisé sur onMount.');
                window.Metro.init();
            } else {
                console.warn('Le script Metro 4 JS a été chargé, mais window.Metro est toujours indéfini. Il pourrait y avoir un problème.');
            }
        };

        // Gère les erreurs potentielles lors du chargement du script
        script.onerror = () => {
            console.error('Échec du chargement du script Metro 4 JS depuis le CDN.');
        };

        document.body.appendChild(script);
    });

    // Utilisez afterUpdate si vous ajoutez/supprimez dynamiquement des éléments
    // avec des data-role de Metro 4 après le rendu initial.
    // C'est souvent nécessaire quand Svelte met à jour le DOM.
    afterUpdate(() => {
 /*        if (window.Metro) {
            // Ré-initialise les composants Metro 4 si de nouveaux éléments sont ajoutés au DOM.
            // Attention : Appeler Metro.init() trop souvent peut être coûteux.
            // Il est parfois préférable d'initialiser spécifiquement les nouveaux éléments.
            // Pour commencer, Metro.init() est souvent suffisant.
            // console.log('Metro 4 ré-initialisé sur afterUpdate.');
            // window.Metro.init(); // Décommentez si les mises à jour dynamiques cassent fréquemment les composants Metro
        } */
    });
</script>

<svelte:head>
    <!-- Les liens CSS sont bien placés ici pour un chargement précoce -->
    <link rel="stylesheet" href="https://cdn.metroui.org.ua/v4/css/metro-all.min.css">
    <link rel="stylesheet" href="https://cdn.metroui.org.ua/4.5.12/icons.css">
</svelte:head>

<slot />
