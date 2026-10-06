# Comment un bot réagit à ce qu'on lui dit

Ce document décrit, cas par cas, ce que doit faire un bot quand un joueur écrit dans le chat, et selon quels facteurs il choisit.
Il sert de cahier des charges : chaque ligne dit si le choix est fait par le code (règle fixe) ou laissé au modèle (il décide avec son caractère).

Légende de la colonne "Qui décide" :
* **code** : règle écrite dans le programme, toujours appliquée.
* **modèle** : le LLM choisit, guidé par les consignes, son caractère et son humeur.
* **à faire** : pas encore géré.

## 1. Les facteurs

| Facteur | Valeurs | Où il est pris |
|---|---|---|
| À qui s'adresse le message | à moi (mon pseudo, ou on n'est que deux) / à tout le monde ("vous", "qq1", "quelqu'un", "les gars") / à un autre joueur / à personne en particulier | code (`agent.js`, réception du chat) |
| Type de message | question d'info, demande d'objet, demande d'aide (action longue), "viens", défi, ordre ou menace, discussion, soupçon de bot | modèle |
| Ce que je fais | rien / une étape de mon objectif / une demande déjà promise / en danger (monstre, peu de vie) | code (action en cours, réflexes) + modèle |
| J'ai l'objet demandé ? | oui (combien) / non | code (inventaire), affiché au modèle |
| Distance au joueur | visible et à N blocs / trop loin pour le voir | code, affiché au modèle |
| Caractère | serviable 0 à 10, flemme 0 à 10 (`agents.json`) | modèle |
| Humeur du jour | motivé, normal, un peu fatigué, de bonne humeur (tirée au hasard) | modèle |
| Quelqu'un a déjà répondu | oui / non | code (demande à tout le monde) + modèle |
| Insistance | 1er message, ou le joueur répète | modèle |

## 2. Demande à tout le monde : un seul bot s'en occupe

Quand un joueur écrit "qqun a de la laine ?" à tout le monde, chaque bot calcule ce que ça lui coûterait :

| Élément du coût | Points |
|---|---|
| J'ai l'objet demandé | 0 |
| Je ne l'ai pas | +2 |
| Pas d'objet précis dans la demande | +1 |
| Distance au joueur | +1 par 20 blocs (2 au plus), +1,5 si je ne le vois pas |
| Je suis en train de faire une action | +1 |
| Peu serviable | +2 x (1 - serviable) |

Le bot attend ensuite 1,5 s + 2,5 s par point avant de réagir : celui à qui ça coûte le moins répond en premier.
Si un autre joueur a répondu entre-temps, il laisse faire et ne dépense même pas d'appel au modèle. C'est ce que ferait un humain qui lit "jen ai" dans le chat.
Il n'y a aucun canal caché entre les bots : ils se coordonnent seulement en lisant le chat, comme les humains (règle du sujet).

Exemple : SAHYGO écrit "qqun a de la laine ?"

| Bot | Laine | Distance | Occupé | Serviable | Coût | Réagit après |
|---|---|---|---|---|---|---|
| Joueur4 (chill) | 3 | 10 blocs | non | 8/10 | 0 + 0,5 + 0 + 0,4 = 0,9 | 3,8 s : "jen ai, tiens" |
| Joueur5 (rusher) | 0 | 40 blocs | oui | 3/10 | 2 + 2 + 1 + 1,4 = 6,4 | 17,5 s : a vu la réponse de Joueur4, ne dit rien |
| Joueur6 (builder) | 0 | invisible | oui | 5/10 | 2 + 1,5 + 1 + 1 = 5,5 | 15,3 s : idem |

## 3. Tous les cas

| # | Situation | Facteurs importants | Réaction attendue | Qui décide |
|---|---|---|---|---|
| 1 | "salut" (à moi) | – | "yo", "salut", parfois rien | modèle |
| 2 | "salut" à tout le monde | bavard | un ou deux répondent, pas les trois en même temps | code (coût) + modèle |
| 3 | "t'es où ?" | – | décrit l'endroit ("vers le spawn", "sous terre") | modèle |
| 4 | "tes coordonnées ?" | – | donne "x z" | modèle |
| 5 | "t'as quoi dans ton inventaire ?" | inventaire | résumé court ("du fer et des diams") | modèle |
| 6 | "qqun a de la laine ?" | objet, distance, occupé, caractère | le bot au coût le plus bas répond et donne ; les autres continuent | code (coût) + modèle |
| 7 | "donne moi 2 diams" (à moi) | j'en ai ? serviable | serviable : donne ; peu serviable : "nan cest a moi" ou contre quelque chose | modèle |
| 8 | Même demande, je n'ai pas l'objet | – | "jen ai pas", ne fait pas semblant | modèle (consigne : ne jamais prétendre) |
| 9 | "viens" / "tp au spawn" | distance, ce que je fais | serviable et libre : "jarrive" ; occupé : "jfinis et jarrive" (promesse) ; flemme : "flemme" | modèle |
| 10 | "aide moi à couper du bois" (long) | serviable, flemme, humeur | serviable : aide ; sinon promesse ou refus | modèle |
| 11 | Je suis en pleine étape importante (cabane, fer) | occupé | plutôt "plus tard", sauf si très serviable | modèle |
| 12 | Je suis en danger (monstre, peu de vie) | réflexes | il fuit ou se défend d'abord, répond après | code (réflexes) |
| 13 | La nuit | – | ne part pas loin pour rendre service | modèle (consigne nuit) |
| 14 | Défi "le premier qui fait un bloc de diams gagne" | caractère, profil | rusher motivé : tente ; chill et builder : "nan", "flemme" | modèle (le code ne transforme pas encore un défi en objectif : à faire) |
| 15 | Ordre agressif "bougez vos race", menace "sinon je vous tue" | humeur | réponse courte, humour ou ignore ("mdr calme toi") | modèle |
| 16 | Le joueur insiste (2e ou 3e fois) | serviable | finit par répondre ou céder, ou dit clairement non | modèle |
| 17 | "t'es un bot ?" | – | "mdr quoi", "t'es sérieux", ou ignore | modèle |
| 18 | Message entre deux autres joueurs | – | ne s'en mêle pas (sauf un peu par bavardage) | code (pas pour moi) + modèle |
| 19 | Un autre joueur a déjà répondu | – | ne répète pas la même réponse | code (demande à tout le monde) + modèle |
| 20 | J'ai promis plus tard et j'ai fini mon truc | promesse | tient la promesse ou "tas tjr besoin ?" | modèle (promesses affichées 20 min) |
| 21 | Personne ne répond à ma question | – | ne la repose pas, passe à autre chose | code (refus de la 2e question) |
| 22 | "on remonte à la surface" | sous terre | remonter (ou promesse) | modèle + outil remonter |
| 23 | "merci" | – | rien, "de rien", "np" | modèle |
| 24 | Demande impossible ("fais moi un bloc de netherite") | – | "jsais pas faire", "cest chaud" | modèle |
| 25 | Échange "2 diams contre 10 fer" | inventaire, intérêt | accepte si ça l'arrange, sinon contre-propose | modèle (troc par lancer d'objets) |
| 26 | Un joueur le frappe | réflexe | se défend ou fuit, puis "pk tu me tape" | code (réflexe) + modèle |

## 4. Ce qu'il reste à faire

* Défi lancé dans le chat (cas 14) : le transformer en objectif quand le bot accepte, pour que le code calcule les étapes (lié aux tâches du plugin).
* Insistance (cas 16) : le modèle voit seulement le dernier message de chaque joueur, il faudra peut-être compter les relances.
* Troc (cas 25) : pas de suivi de ce qui a été promis en échange.
