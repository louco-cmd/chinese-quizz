// public/js/notifications.js
// Gestion des notifications push Web pour Jiayou

(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────────────

  function getVapidKey() {
    const meta = document.querySelector('meta[name="vapid-key"]');
    return meta ? meta.getAttribute('content') : null;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  }

  // ── API serveur ───────────────────────────────────────────────────────────

  async function registerSubscription(subscription) {
    const key = subscription.getKey('p256dh');
    const authKey = subscription.getKey('auth');
    await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: btoa(String.fromCharCode(...new Uint8Array(key))),
          auth:   btoa(String.fromCharCode(...new Uint8Array(authKey))),
        },
      }),
    });
  }

  // Sauvegarde la PRÉFÉRENCE utilisateur (source de vérité du toggle)
  async function savePreference(enabled) {
    console.log('[Push] savePreference →', enabled);
    const res = await fetch('/api/notifications/preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ enabled }),
    });
    console.log('[Push] savePreference ←', res.status, res.ok);
    return res.ok;
  }

  // ── API publique ──────────────────────────────────────────────────────────

  /**
   * Retourne l'état actuel depuis le serveur (préférence user).
   */
  window.getNotifStatus = async function () {
    try {
      const res = await fetch('/api/notifications/status', { credentials: 'include' });
      if (!res.ok) return { subscribed: false, enabled: false };
      return await res.json();
    } catch {
      return { subscribed: false, enabled: false };
    }
  };

  /**
   * Tente l'abonnement push SW (silencieux si non supporté).
   */
  window.subscribePush = async function () {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const vapidKey = getVapidKey();
    if (!vapidKey) return false;

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;

      const reg = await navigator.serviceWorker.ready;
      // Réutilise une subscription existante ou en crée une
      let subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      }
      await registerSubscription(subscription);
      return true;
    } catch (err) {
      console.warn('[Push] SW subscribe failed (non-blocking):', err.message);
      return false;
    }
  };

  /**
   * Supprime la subscription push côté navigateur + serveur.
   */
  window.unsubscribePush = async function () {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/notifications/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
    } catch (err) {
      console.warn('[Push] Unsubscribe error:', err.message);
    }
  };

  /**
   * Basculer depuis le toggle UI.
   *
   * La PRÉFÉRENCE est sauvegardée immédiatement sur users.notifications_enabled
   * → persiste quelle que soit l'issue du push SW.
   * Le push SW est tenté en bonus (non bloquant).
   */
  window.handleNotifToggle = async function (enable) {
    const toggle = document.getElementById('notifToggle');
    if (toggle) toggle.disabled = true;

    try {
      // 1. Sauvegarder la préférence (toujours, peu importe le push SW)
      const saved = await savePreference(enable);
      if (!saved) {
        // Revert si erreur serveur
        if (toggle) toggle.checked = !enable;
        return;
      }

      // 2. Tenter le push SW en bonus (silencieux)
      if (enable) {
        window.subscribePush(); // non-await intentionnel : non bloquant
      }

    } catch (err) {
      console.error('[Push] Toggle error:', err);
      if (toggle) toggle.checked = !enable;
    } finally {
      if (toggle) toggle.disabled = false;
    }
  };

  // ── Initialisation du toggle au chargement ────────────────────────────────
  async function initNotifToggle() {
    const toggle = document.getElementById('notifToggle');
    if (!toggle) return;

    console.log('[Push] initNotifToggle → fetching status...');
    // Source de vérité = préférence serveur
    try {
      const data = await window.getNotifStatus();
      console.log('[Push] initNotifToggle ← status:', data);
      toggle.checked = !!data.enabled;
    } catch (e) {
      console.warn('[Push] init failed:', e);
    }
  }

  // Fonctionne que le DOM soit déjà prêt ou pas encore
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNotifToggle);
  } else {
    initNotifToggle();
  }

})();
