# Cookidoo

Faites entrer votre compte **Cookidoo** — le service de recettes du **Thermomix** — dans Gladys :
la liste de courses et le planning de la semaine deviennent des capteurs, des widgets de tableau
de bord et des actions de scène.

> Sans lien avec Vorwerk. Cookidoo et Thermomix sont des marques de Vorwerk.
>
> **Développée sans compte Cookidoo : vos retours sont les bienvenus.** L'intégration suit le
> protocole de la bibliothèque libre [cookidoo-api](https://github.com/miaucl/cookidoo-api),
> utilisée par Home Assistant, et elle est testée sur ses réponses enregistrées, pas encore sur un
> vrai compte.

## Présentation

- **Liste de courses** : les ingrédients des recettes ajoutées à la liste et les articles libres
  que vous avez tapés, cochés ou non ; le nombre d'articles restant à acheter.
- **Planning** : les recettes prévues aujourd'hui (noms, temps total), et le widget « recette du
  jour ».
- **Abonnement** : son type (Premium, essai, gratuit) et sa date de fin.
- **Actions de scène** : ajouter un article (« Ajoute du lait » depuis un bouton ou une commande
  vocale), cocher ou décocher un article, vider les articles cochés.
- **Widgets** : la liste de courses avec des boutons pour ajouter, cocher et vider, et la recette
  du jour.

## Prérequis

- Gladys Assistant **5.2.0** ou plus récent (les boutons des widgets ouvrent un petit formulaire,
  qui demande la 5.2.0).
- Un compte Cookidoo qui se connecte avec un e-mail et un mot de passe, avec ou sans abonnement.
- Un accès à Internet depuis Gladys : l'intégration parle aux serveurs de Cookidoo (cloud).

## Configuration

Installez l'intégration depuis **Intégrations → Installer depuis GitHub**, puis renseignez :

| Champ                          | Quoi saisir                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-mail, Mot de passe           | Ceux de votre compte Cookidoo.                                                                                                                                      |
| Pays du compte                 | Le pays choisi à la création du compte : il fixe le site Cookidoo (cookidoo.fr, cookidoo.de, cookidoo.international pour les pays sans site propre...).             |
| Langue de Cookidoo             | Langue des recettes et des articles. _Automatique_ prend la langue du pays la plus proche du champ suivant (français sur cookidoo.fr, allemand sur cookidoo.ch...). |
| Langue des noms et des états   | Langue des noms des fonctionnalités (fixés une fois, à l'ajout de l'appareil) et des textes affichés par l'appareil. Français par défaut.                           |
| Intervalle de rafraîchissement | Fréquence de lecture de la liste et du planning : de 2 à 30 minutes, 5 par défaut. Vos propres changements depuis Gladys s'affichent aussitôt.                      |

Allez ensuite dans l'onglet **Découverte** et ajoutez l'appareil **Cookidoo**.

### Tester la connexion

Le bouton **Tester la connexion** se reconnecte avec le mot de passe et relit tout : la réponse
donne le nombre d'articles restants, la recette du jour et l'abonnement, ou la raison de l'échec.
Après un mot de passe refusé, l'intégration cesse de se reconnecter d'elle-même (réessayer
pourrait bloquer le compte) : corrigez le mot de passe ou lancez ce test.

### Données et vie privée

Le mot de passe reste dans la configuration de Gladys. Les jetons de connexion (valables 12
heures, renouvelés automatiquement) et l'identifiant de votre profil Cookidoo sont gardés dans le
volume de données de l'intégration (`/data/cookidoo.json`, lisible par elle seule). Rien n'est
envoyé ailleurs qu'à Cookidoo, et aucun mot de passe, jeton ou e-mail n'est écrit dans les
journaux.

## L'appareil

Un appareil **Cookidoo** par compte, avec ces fonctionnalités (en lecture seule) :

| Fonctionnalité              | Type          | Valeur                                                                     |
| --------------------------- | ------------- | -------------------------------------------------------------------------- |
| Articles à acheter          | compteur      | articles non cochés de la liste de courses                                 |
| Articles cochés             | compteur      | articles cochés, encore sur la liste                                       |
| Liste de courses            | texte         | les articles à acheter, séparés par des virgules (« Liste vide » sinon)    |
| Recettes du jour            | texte         | les recettes prévues aujourd'hui dans Cookidoo (« Aucune recette prévue ») |
| Nombre de recettes du jour  | compteur      | combien de recettes sont prévues aujourd'hui                               |
| Temps des recettes du jour  | durée (min)   | temps total des recettes du jour                                           |
| Abonnement                  | texte         | Premium, Essai ou Gratuit                                                  |
| Fin de l'abonnement         | texte         | date de fin de l'abonnement (« Aucune » sans abonnement)                   |
| Jours d'abonnement restants | durée (jours) | jours avant la fin de l'abonnement, 0 sans abonnement                      |

« Aujourd'hui » est le jour dans le fuseau horaire de Gladys.

## Widgets

Ajoutez-les depuis l'éditeur du tableau de bord (**Widgets d'intégrations**).

### Liste de courses (shopping_list)

Le nombre d'articles à acheter et cochés, les huit premiers articles (ceux à acheter d'abord,
puis les cochés avec une pastille), et quatre boutons :

- **Ajouter** : tapez le nom d'un article ;
- **Cocher** / **Décocher** : choisissez un article dans la liste ;
- **Vider les cochés** : retire ce qui a été acheté (demande confirmation).

Les widgets de Gladys n'ont pas de case à cocher, par choix : un appui sur Cocher ouvre un petit
formulaire dont la liste contient les articles à acheter.

### Recette du jour (recipe_of_the_day)

Les recettes prévues aujourd'hui, avec leur photo, leur temps et un lien pour les ouvrir dans
Cookidoo. Quand rien n'est prévu aujourd'hui, les prochaines recettes de la semaine, avec leur
jour.

## Actions de scène

Dans une scène, **Ajouter une action → Intégrations**. Le nom de l'article accepte les variables
de scène.

### Ajouter à la liste Cookidoo (add_item)

Ajoute un article libre à la liste de courses, sauf si un article de ce nom y est déjà à acheter ;
un article coché de ce nom est remis sur la liste au lieu d'être doublé. Sorties : _Article
ajouté_ (oui/non), _Articles à acheter_.

### Cocher un article Cookidoo (check_item)

Coche l'article de ce nom (sans tenir compte des majuscules, des accents ni d'un article en tête :
« du lait » trouve « Lait »). Quand plusieurs articles pourraient correspondre, rien n'est coché.
Sorties : _Article trouvé_, _Articles à acheter_.

### Décocher un article Cookidoo (uncheck_item)

Remet un article coché sur la liste, trouvé de la même façon. Sorties : _Article trouvé_,
_Articles à acheter_.

### Vider les articles cochés Cookidoo (clear_checked_items)

Retire les articles libres cochés, et les recettes dont tous les ingrédients sont cochés.
Cookidoo ne retire un ingrédient qu'avec sa recette : une recette achetée en partie reste sur la
liste. Sortie : _Articles retirés_.

## Exemples de scènes

- **« Ajoute du lait » depuis un bouton** : déclencheur _un bouton est appuyé_ → action _Ajouter à
  la liste Cookidoo_ avec `Lait` → _Envoyer un message_ « Lait ajouté, {{articles à acheter}}
  articles à acheter ».
- **Rappel des courses** : chaque samedi à 9 h, si _Articles à acheter_ est supérieur à 0 → envoyer
  un message avec la valeur de la fonctionnalité _Liste de courses_.
- **Retour des courses** : quand vous rentrez le samedi après-midi → _Vider les articles cochés
  Cookidoo_.
- **À vos fourneaux** : chaque jour à 18 h 30, si _Nombre de recettes du jour_ est supérieur à 0 →
  message « Ce soir : {{recettes du jour}} ({{temps}} min) ».
- **Abonnement** : quand _Jours d'abonnement restants_ passe sous 7 → rappel.

## Rafraîchissement et usage de l'API

Gladys n'interroge pas cet appareil : l'intégration lit Cookidoo avec son propre minuteur, et
seulement quand quelqu'un regarde (l'appareil est ajouté, ou un widget a été affiché dans l'heure).
Chaque rafraîchissement fait deux requêtes (liste de courses et planning) ; l'abonnement est lu
toutes les 6 heures ; le jeton d'accès est renouvelé deux fois par jour. Avec 5 minutes par
défaut, cela fait environ 600 requêtes par jour. Cookidoo ne publie ni quota ni conditions pour
cet usage : ne descendez pas l'intervalle plus bas que nécessaire. Les valeurs ne sont publiées
que lorsqu'elles changent, plus une fois toutes les 6 heures.

## Dépannage

- **« Cookidoo a refusé la connexion »** : vérifiez l'e-mail, le mot de passe et le pays. Si
  Cookidoo demande une étape (nouvelles conditions d'utilisation, vérification par e-mail),
  connectez-vous une fois sur le site ou dans l'appli, puis lancez **Tester la connexion**.
- **« Cookidoo a refusé la connexion de l'intégration (protection anti-robot) »** : la protection
  de Cookidoo a refusé la requête. L'intégration ne la contourne jamais : elle attend 30 minutes
  et réessaie. Si cela dure, signalez-le sur le forum.
- **« Cookidoo a répondu dans un format inattendu »** : Cookidoo a changé son API ; mettez à jour
  l'intégration (et ouvrez une issue s'il n'existe pas encore de mise à jour).
- **Articles ou recettes vides** : vérifiez le pays et la langue de Cookidoo.
- Plus de détails : réglez `LOG_LEVEL=debug` sur l'intégration et lisez ses journaux.

## Limites

- API non officielle : Cookidoo peut la changer à tout moment, et la connexion peut alors échouer
  jusqu'à une mise à jour.
- Lecture toutes les quelques minutes : un changement fait dans l'appli Cookidoo s'affiche au
  rafraîchissement suivant.
- Seuls les articles libres peuvent être ajoutés ; un ingrédient est retiré avec sa recette.
- Aucune commande du Thermomix lui-même, pas de recherche de recettes, pas de planification
  depuis Gladys.
- Un seul compte par intégration.
