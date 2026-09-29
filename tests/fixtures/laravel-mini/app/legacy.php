<?php

class LegacyReport
{
    public function owner()
    {
        return new app\models\user();
    }
}

class LegacyFormatter
{
    public static function format(string $text): string
    {
        return trim($text);
    }
}
