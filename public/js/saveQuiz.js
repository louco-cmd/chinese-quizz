// function endQuiz() {
//   console.log("🏁 endQuiz() appelée (version FORCE)");

//   // Stopper le quiz de manière définitive
//   quizForm.onsubmit = null;
//   quizForm.replaceWith; // safety
  
//   // Supprimer tous les handlers encore actifs
//   checkBtn.onclick = null;
//   checkBtn.onmousedown = null;
//   checkBtn.onkeyup = null;

//   // Forcer l’arrêt de tous les timers existants
//   let id = window.setTimeout(() => {}, 0);
//   while (id--) {
//     window.clearTimeout(id);
//     window.clearInterval(id);
//   }

//   // ÉCRASER TOUT le contenu du formulaire 
//   quizForm.innerHTML = `
//     <div class="text-center my-3">
//       <h3 class="fw-bold">🎉 Quiz Terminé enfin!</h3>
//       <p class="fs-5 text-success fw-bold">Score final : ${correctCount}/${quizWords.length}</p>

//       <button id="rewardBtn" class="btn btn-success w-100 mt-3">
//         <i class="bi bi-coin me-2"></i>Gagner 5$
//       </button>
//     </div>
//   `;

//   // Désactiver le formulaire définitivement
//   quizForm.onkeydown = (e) => e.preventDefault();
//   quizForm.oninput = (e) => e.preventDefault();
//   quizForm.onclick = (e) => e.stopPropagation();

//   // Mettre à jour la variable globale (empêche showQuizWord)
//   window.quizEnded = true;

//   // Instancier le nouveau bouton
//   const rewardBtn = document.getElementById("rewardBtn");
//   rewardBtn.addEventListener("click", () => {
//     window.location.href = "/quiz";
//   });

//   // Sauvegarde
//   console.log("💾 Sauvegarde des résultats...");
//   saveQuizResults(correctCount, quizWords.length, "pinyin", quizResults);
// }

// 📍 Après la fin d'un quiz, ajoute cette fonction
async function saveQuizResults(correctCount, totalWords, quizType, quizResults, coinsEarned = 0) {
    try {
        console.log('💾 Sauvegarde résultats quiz...', { 
            correctCount, 
            totalWords, 
            quizType, 
            coinsEarned,
            quizResults 
        });

        const response = await fetch('/save-quiz-results', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                correct_count: correctCount,
                total_words: totalWords,
                quiz_type: quizType,
                quiz_results: quizResults,
                coins_earned: coinsEarned // ← Nouveau paramètre
            })
        });

        const result = await response.json();
        
        if (result.success) {
            console.log('✅ Résultats sauvegardés avec succès!');
            if (coinsEarned > 0) {
                console.log(`💰 ${coinsEarned} pièces gagnées!`);
            }
        } else {
            console.error('❌ Erreur sauvegarde:', result.message);
        }
    } catch (error) {
        console.error('❌ Erreur réseau:', error);
    }
}
