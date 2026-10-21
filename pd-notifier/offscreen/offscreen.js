// Offscreen document used to play the notification sound, as service workers can't play audio.

chrome.runtime.onMessage.addListener(function(message)
{
    if (message.target !== 'offscreen' || message.type !== 'play-sound') { return; }

    const notifSound = new Audio('../audio/notification.mp3');
    notifSound.play().catch(function(e) { console.error('Unable to play notification sound.', e); });
});
