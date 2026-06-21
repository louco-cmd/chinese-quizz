// ==================================================
// FONCTIONS COMMUNES POUR LES QUIZ
// ==================================================

// 🔥 VARIABLES GLOBALES PARTAGÉES
let hoverModal = null;
let cacheMots = null;
let dernierFetch = 0;
const CACHE_DURATION = 5 * 60 * 1000;
let hoverTimeout = null;

// ==================================================
// GESTION AUDIO — voix pré-chargées
// ==================================================

let _voiceEn = null;
let _voiceZh = null;
let _voicesLoaded = false;

function _loadVoices() {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return false;
    _voicesLoaded = true;

    // Voix anglaise : préférer en-GB ou en-US natif (pas Google)
    _voiceEn = voices.find(v => v.lang === 'en-GB' && !v.name.toLowerCase().includes('google')) ||
               voices.find(v => v.lang === 'en-US' && !v.name.toLowerCase().includes('google')) ||
               voices.find(v => v.lang.startsWith('en-')  && !v.name.toLowerCase().includes('google')) ||
               voices.find(v => v.lang.startsWith('en-'));

    // Voix chinoise : préférer zh-CN natif
    _voiceZh = voices.find(v => v.lang === 'zh-CN' && !v.name.toLowerCase().includes('google')) ||
               voices.find(v => v.lang.startsWith('zh-')  && !v.name.toLowerCase().includes('google')) ||
               voices.find(v => v.lang.startsWith('zh-'));

    console.log('🔊 Voix EN:', _voiceEn?.name, '| ZH:', _voiceZh?.name);
    return true;
}

if ('speechSynthesis' in window) {
    // Tentative immédiate
    if (!_loadVoices()) {
        // onvoiceschanged (Chrome desktop)
        speechSynthesis.onvoiceschanged = _loadVoices;
        // Retry polling pour Safari/iOS/mobile qui ne déclenche pas l'event
        let _retries = 0;
        const _retryInterval = setInterval(() => {
            if (_loadVoices() || ++_retries >= 20) clearInterval(_retryInterval);
        }, 250);
    }
}

/**
 * Lit un texte avec la bonne voix selon la langue
 */
function speakText(text, lang) {
    if (!('speechSynthesis' in window) || !text) return;

    // Auto-détection si pas de lang forcée
    const isChinese = /[一-鿿]/.test(text);
    const resolvedLang = lang || (isChinese ? 'zh-CN' : 'en-US');

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = resolvedLang;
    utterance.rate = resolvedLang.startsWith('zh') ? 0.8 : 0.95;

    // Assigner la voix pré-chargée
    if (resolvedLang.startsWith('en') && _voiceEn) {
        utterance.voice = _voiceEn;
    } else if (resolvedLang.startsWith('zh') && _voiceZh) {
        utterance.voice = _voiceZh;
    } else {
        // Fallback : chercher en live
        const voices = speechSynthesis.getVoices();
        const voice = voices.find(v => v.lang.startsWith(resolvedLang.split('-')[0]) && !v.name.toLowerCase().includes('google')) ||
                      voices.find(v => v.lang.startsWith(resolvedLang.split('-')[0]));
        if (voice) utterance.voice = voice;
    }

    speechSynthesis.cancel(); // stopper toute lecture en cours
    speechSynthesis.speak(utterance);
}

/**
 * Active les boutons audio sur un élément
 */
function activateAudioButtons(container) {
    container.querySelectorAll('.btn-audio').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const text = btn.getAttribute('data-text');
            const lang = btn.getAttribute('data-lang') || 'zh-CN';
            if (text) {
                speakText(text, lang);
            }
        });
    });
}

// ==================================================
// GESTION CARACTÈRES CHINOIS & HOVER
// ==================================================

/**
 * Transforme les caractères chinois en éléments interactifs
 */
function transformChineseCharacters(chineseWord, container) {
    if (!container || !chineseWord) return;

    container.classList.add('chinese-container');
    const characters = Array.from(chineseWord);
    
    if (characters.length <= 1) {
        container.textContent = chineseWord;
        return;
    }
    
    container.innerHTML = '';
    
    characters.forEach((character) => {
        const span = document.createElement('span');
        span.className = 'chinese-character';
        span.setAttribute('data-char', character);
        span.textContent = character;
        
        span.addEventListener('mouseenter', (e) => {
            if (hoverTimeout) {
                clearTimeout(hoverTimeout);
                hoverTimeout = null;
            }
            handleCharacterHover(e);
        });
        
        span.addEventListener('mouseleave', () => {
            hoverTimeout = setTimeout(() => {
                if (hoverModal) {
                    hoverModal.style.display = 'none';
                }
            }, 200);
        });
        
        container.appendChild(span);
    });
}

/**
 * Gère le hover sur un caractère chinois
 */
function handleCharacterHover(event) {
    const character = event.target.getAttribute('data-char');
    const container = event.target.closest('.chinese-container');
    if (!container) return;
    
    fetchCharacterData(character, event);
}

/**
 * Récupère les données d'un caractère pour l'affichage hover
 */
async function fetchCharacterData(character, event) {
    try {
        console.log('🔍 Recherche pour:', character);
        
        if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
        }
        
        if (!hoverModal) {
            createHoverModal();
        }

        // Positionnement
        if (event && event.target) {
            positionHoverModal(event.target);
        }
        
        // Afficher la modale avec spinner
        hoverModal.style.display = 'block';
        hoverModal.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 2rem; font-weight: bold; margin-bottom: 10px;">${character}</div>
                <div class="spinner-border spinner-border-sm text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
            </div>
        `;

        // Recherche des données
        let caractereExact = await findCharacterInData(character);
        
        // Mise à jour de la modale
        if (hoverModal && hoverModal.style.display !== 'none') {
            updateHoverModalContent(character, caractereExact);
        }

    } catch (error) {
        console.error('❌ Erreur fetchCharacterData:', error);
        showHoverError(character);
    }
}

/**
 * Crée la modale de hover
 */
function createHoverModal() {
    hoverModal = document.createElement('div');
    hoverModal.className = 'character-modal';
    hoverModal.style.cssText = `
        position: fixed;
        width: 200px;
        height: auto;
        z-index: 10000;
        display: none;
        background: white;
        border: 2px solid #0d6efd;
        border-radius: 10px;
        box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15);
        padding: 15px;
        pointer-events: auto;
    `;
    
    hoverModal.addEventListener('mouseenter', () => {
        if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
        }
    });
    
    hoverModal.addEventListener('mouseleave', () => {
        hoverTimeout = setTimeout(() => {
            if (hoverModal) {
                hoverModal.style.display = 'none';
            }
        }, 200);
    });
    
    document.body.appendChild(hoverModal);
}

/**
 * Positionne la modale de hover
 */
function positionHoverModal(targetElement) {
    const rect = targetElement.getBoundingClientRect();
    const scrollX = window.scrollX || document.documentElement.scrollLeft;
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    
    const centerX = rect.left + (rect.width / 2) + scrollX;
    const characterTop = rect.top + scrollY;
    
    hoverModal.style.left = `${centerX}px`;
    hoverModal.style.top = `${characterTop - 5}px`;
    hoverModal.style.transform = 'translateX(-50%) translateY(+30%)';
}

/**
 * Recherche un caractère dans les données
 */
async function findCharacterInData(character) {
    // Recherche dans les mots actuels
    let caractereExact = window.quizWords?.find(mot => 
        mot && mot.chinese && mot.chinese.length === 1 && mot.chinese === character
    );
    
    // Recherche dans le cache
    if (!caractereExact && cacheMots) {
        caractereExact = cacheMots.find(mot => 
            mot && mot.chinese && mot.chinese.length === 1 && mot.chinese === character
        );
    }

    // Chargement du cache si nécessaire
    if (!caractereExact && (!cacheMots || Date.now() - dernierFetch > CACHE_DURATION)) {
        try {
            const response = await fetch('/api/tous-les-mots');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            cacheMots = await response.json();
            dernierFetch = Date.now();
            
            caractereExact = cacheMots.find(mot => 
                mot && mot.chinese && mot.chinese.length === 1 && mot.chinese === character
            );
        } catch (cacheError) {
            console.error('❌ Erreur cache:', cacheError);
            cacheMots = [];
        }
    }

    // Recherche dans les mots composés
    if (!caractereExact) {
        const motContenant = cacheMots?.find(mot => 
            mot && mot.chinese && mot.chinese.includes(character) && mot.chinese.length > 1
        );
        
        if (motContenant) {
            caractereExact = {
                chinese: character,
                pinyin: `(Part of: ${motContenant.pinyin})`,
                english: `Component of: ${motContenant.english}`,
                hsk: motContenant.hsk
            };
        }
    }

    return caractereExact;
}

/**
 * Met à jour le contenu de la modale hover
 */
function updateHoverModalContent(character, caractereExact) {
    if (caractereExact) {
        hoverModal.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 2rem; font-weight: bold; margin-bottom: 10px;">${character}</div>
                <div style="background: #e3f2fd; color: #1976d2; padding: 5px 10px; border-radius: 5px; margin-bottom: 8px;">
                    ${caractereExact.pinyin || 'N/A'}
                </div>
                <div style="color: #666; margin-bottom: 8px;">
                    ${caractereExact.english || 'No translation'}
                </div>
                ${caractereExact.hsk ? `
                    <div style="background: #e8f5e8; color: #2e7d32; padding: 3px 8px; border-radius: 5px; font-size: 0.8rem;">
                        HSK ${caractereExact.hsk}
                    </div>
                ` : ''}
            </div>
        `;
    } else {
        hoverModal.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 2rem; font-weight: bold; margin-bottom: 10px;">${character}</div>
                <div style="color: #999; font-size: 0.9rem;">Caractère non enregistré</div>
            </div>
        `;
    }
}

/**
 * Affiche une erreur dans la modale hover
 */
function showHoverError(character) {
    if (hoverModal && hoverModal.style.display !== 'none') {
        hoverModal.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 2rem; font-weight: bold; margin-bottom: 10px;">${character}</div>
                <div style="color: #d32f2f; font-size: 0.9rem;">Erreur de chargement</div>
            </div>
        `;
    }
}

// ==================================================
// GESTION CARTES DE MOTS
// ==================================================

/**
 * Retourne le picto selon le score de connaissance
 */
function getScorePicto(score) {
    if (score >= 80) return '🥳';  // 80-100 : Excellent
    if (score >= 60) return '☺️';  // 60-79 : Bon
    if (score >= 40) return '😑';  // 40-59 : Moyen
    if (score >= 20) return '🥺';  // 20-39 : Faible
    if (score >= 1) return '😭';   // 1-19 : Très faible
    return '🫥';                   // 0 : Non appris
}

/**
 * Affiche une carte de caractère dans le quiz
 */
function showCharacterCardInQuiz(word, container) {
    const cardHTML = createSimpleCharacterCard(word);
    const cardElement = document.createElement('div');
    cardElement.innerHTML = cardHTML;
    cardElement.id = 'character-card-feedback';
    
    container.parentNode.insertBefore(cardElement, container);
    
    // Activer les fonctionnalités
    activateCardFeatures(cardElement, word);
    
    return cardElement;
}

/**
 * Active toutes les fonctionnalités d'une carte
 */
function activateCardFeatures(cardElement, word) {
    // Audio
    activateAudioButtons(cardElement);
    
    // Caractères interactifs
    const chineseContainer = cardElement.querySelector('.chinese-clickable');
    if (chineseContainer && word.chinese) {
        transformChineseCharacters(word.chinese, chineseContainer);
    }
    
    // Bouton continuer
    const continueBtn = cardElement.querySelector('.continue-quiz-btn');
    if (continueBtn) {
        continueBtn.addEventListener('click', () => {
            cardElement.remove();
        });
    }
}

/**
 * Cache la carte de caractère
 */
function hideCharacterCard() {
    const card = document.getElementById('character-card-feedback');
    if (card) {
        card.remove();
    }
}

// S'assurer que la fonction est accessible
window.showCardDetails = function(wordId, chineseText) {
  // Votre code existant pour afficher les détails
  console.log('Show card for:', chineseText, 'ID:', wordId);
  // Ouvrir une modal ou afficher des détails
};

// ==================================================
// EXPORT POUR LES MODULES (si besoin)
// ==================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        speakText,
        activateAudioButtons,
        transformChineseCharacters,
        getScorePicto,
        createSimpleCharacterCard,
        showCharacterCardInQuiz,
        hideCharacterCard,
        shuffleArray,
        disableSubmitButton,
        enableSubmitButton
    };
}