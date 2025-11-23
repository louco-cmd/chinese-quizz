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
async function saveQuizResults(score, totalQuestions, quizType, results) {
  try {
    console.log('📤 Envoi des résultats au serveur:', {
      score,
      totalQuestions,
      quizType,
      results: results.map(r => ({ mot_id: r.mot_id, correct: r.correct }))
    });
    
    const response = await fetch('/api/quiz/save', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        score: score,
        total_questions: totalQuestions,
        quiz_type: quizType,
        results: results
      })
    });
    

    const data = await response.json();
    console.log('📥 Réponse du serveur:', data);
    
    if (data.success) {
      console.log('✅ Quiz sauvegardé avec scores détaillés');
    } else {
      console.warn('⚠️ Quiz non sauvegardé:', data.error);
    }
    
  } catch (error) {
    console.error('❌ Erreur sauvegarde quiz:', error);
  }
}
