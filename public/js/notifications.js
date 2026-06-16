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

  // ── API ───────────────────────────────────────────────────────────────────

  async function registerSubscription(subscription) {
    const key = subscription.getKey('p256dh');
    const authKey = subscription.getKey('auth');
    await fetch('/api/notifications/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: btoa(String.fromCharCode(...new Uint8Array(key))),
          auth:   btoa(String.fromCharCode(...new Uint8Array(authKey))),
        },
      }),
    });
  }

  async function removeSubscription(subscription) {
    await fetch('/api/notifications/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  }

  // ── API publique ──────────────────────────────────────────────────────────

  /**
   * Retourne l'état actuel des notifs depuis le serveur.
   * @returns {{ subscribed: boolean, enabled: boolean }}
   */
  window.getNotifStatus = async function () {
    try {
      const res = await fetch('/api/notifications/status');
      if (!res.ok) return { subscribed: false, enabled: false };
      return await res.json();
    } catch {
      return { subscribed: false, enabled: false };
    }
  };

  /**
   * Demande la permission et enregistre la subscription push.
   * @returns {boolean} true si succès
   */
  window.subscribePush = async function () {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert("Your browser doesn't support push notifications.");
      return false;
    }
    const vapidKey = getVapidKey();
    if (!vapidKey) {
      console.warn('[Push] Clé VAPID absente — notifications non configurées.');
      return false;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert("Permission denied. Enable notifications in your browser settings.");
      return false;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      await registerSubscription(subscription);
      return true;
    } catch (err) {
      console.error('[Push] Erreur subscription:', err);
      return false;
    }
  };

  /**
   * Supprime la subscription push (côté navigateur + serveur).
   * @returns {boolean} true si succès
   */
  window.unsubscribePush = async function () {
    if (!('serviceWorker' in navigator)) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        await removeSubscription(subscription);
        await subscription.unsubscribe();
      }
      return true;
    } catch (err) {
      console.error('[Push] Erreur unsubscription:', err);
      return false;
    }
  };

  /**
   * Basculer depuis le toggle UI.
   * Si l'utilisateur n'est pas encore abonné → subscribe complet.
   * Si déjà abonné → juste activer/désactiver côté serveur.
   */
  window.handleNotifToggle = async function (enable) {
    const toggle = document.getElementById('notifToggle');
    if (toggle) toggle.disabled = true;

    try {
      if (enable) {
        const ok = await window.subscribePush();
        if (!ok && toggle) toggle.checked = false; // Revert si échec
      } else {
        await window.unsubscribePush();
      }
    } finally {
      if (toggle) toggle.disabled = false;
    }
  };

  // ── Initialisation du toggle au chargement ────────────────────────────────
  document.addEventListener('DOMContentLoaded', async function () {
    const toggle = document.getElementById('notifToggle');
    if (!toggle) return;

    // Vérifier aussi côté navigateur si on a une subscription active
    let browserSubscribed = false;
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        browserSubscribed = !!sub;
      } catch {}
    }

    const { enabled } = await window.getNotifStatus();
    toggle.checked = browserSubscribed && enabled;
  });
})();
