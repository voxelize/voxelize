<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\URL;

/** A signed link that confirms the address and opens the web client. */
class VerifyEmailLink extends Notification
{
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function url(object $notifiable): string
    {
        return URL::temporarySignedRoute('verification.verify', now()->addHours(24), [
            'id' => $notifiable->public_id,
            'hash' => sha1($notifiable->getEmailForVerification()),
        ]);
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject('Confirm your email address')
            ->line('Welcome, '.$notifiable->username.'! Confirm this address so you can get back into your account if you forget your password.')
            ->action('Confirm my address', $this->url($notifiable))
            ->line('The link works for 24 hours.');
    }
}
