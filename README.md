# Décodix

Un Mastermind quotidien dans l'esprit Wordle/Tusmo : devine un code secret à 6 chiffres grâce à un feedback positionnel (bien placé / présent / absent) et à deux indices globaux de déduction (somme des chiffres, nombre de chiffres pairs).

Deux modes :
- **Défi du jour** — un seul code par jour (seed déterministe sur la date UTC), 8 essais, série de victoires conservée dans `localStorage`.
- **Mode rapide** — parties illimitées, code aléatoire à chaque partie, sans score ni classement.

## Stack

100 % front-end : HTML / CSS / JS vanilla, aucune dépendance, aucun backend. Les données (secret, essais, série) vivent uniquement dans `localStorage` du navigateur.

## Lancer en local

Ouvrir `index.html` dans un navigateur, ou servir le dossier avec n'importe quel serveur statique :

```sh
npx serve .
```

## Déploiement

Projet statique sans configuration : importable directement sur [Vercel](https://vercel.com/new) (aucun `vercel.json` nécessaire).
