<?php

// Extracts class-level code references between files in <source-dir>/ (plus route references and
// container/event wiring) using nikic/php-parser from code-atlas's own vendor/.
// Usage: php deps.php <repo-root> <source-dir> <routes-dir> <providers-prefix> <output.json>

declare(strict_types=1);

require __DIR__.'/../../vendor/autoload.php';

use PhpParser\Node;
use PhpParser\Node\Expr;
use PhpParser\Node\Name\FullyQualified;
use PhpParser\Node\Stmt;
use PhpParser\NodeFinder;
use PhpParser\NodeTraverser;
use PhpParser\NodeVisitor\NameResolver;
use PhpParser\NodeVisitor\ParentConnectingVisitor;
use PhpParser\ParserFactory;

$root = realpath($argv[1] ?? '.');
$sourceDir = trim($argv[2] ?? 'app', '/');
$routesDir = trim($argv[3] ?? '', '/');
$providersPrefix = $sourceDir.'/'.ltrim($argv[4] ?? '', '/');
$output = $argv[5] ?? 'php://stdout';
$parser = (new ParserFactory)->createForNewestSupportedVersion();
$finder = new NodeFinder;

/** @return list<string> */
function phpFiles(string $dir): array
{
    $files = [];
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        if ($file->getExtension() === 'php') {
            $files[] = $file->getPathname();
        }
    }
    sort($files);

    return $files;
}

/** @return array<int, Node> */
function parse(string $path): array
{
    global $parser;

    $traverser = new NodeTraverser(new NameResolver, new ParentConnectingVisitor);

    return $traverser->traverse($parser->parse(file_get_contents($path)) ?? []);
}

function referenceKind(FullyQualified $name): string
{
    $parent = $name->getAttribute('parent');

    if ($parent instanceof Stmt\Class_ && $parent->extends === $name) {
        return 'extends';
    }
    if ($parent instanceof Stmt\ClassLike) {
        return 'implements';
    }

    return match (true) {
        $parent instanceof Stmt\TraitUse => 'trait',
        $parent instanceof Expr\New_ => 'new',
        $parent instanceof Expr\StaticCall, $parent instanceof Expr\StaticPropertyFetch => 'static-call',
        $parent instanceof Expr\ClassConstFetch => $parent->name instanceof Node\Identifier && $parent->name->toLowerString() === 'class' ? 'class-ref' : 'const',
        $parent instanceof Expr\Instanceof_ => 'instanceof',
        $parent instanceof Stmt\Catch_ => 'catch',
        $parent instanceof Node\Attribute => 'attribute',
        default => typeKind($parent),
    };
}

function typeKind(?Node $node): string
{
    while ($node instanceof Node\NullableType || $node instanceof Node\UnionType || $node instanceof Node\IntersectionType) {
        $node = $node->getAttribute('parent');
    }
    if ($node instanceof Node\Param) {
        $function = $node->getAttribute('parent');

        return $function instanceof Stmt\ClassMethod && $function->name->toLowerString() === '__construct' ? 'inject' : 'type';
    }

    return $node instanceof Stmt\Property || $node instanceof Node\FunctionLike ? 'type' : 'other';
}

function isImport(Node $name): bool
{
    $parent = $name->getAttribute('parent');

    return $parent instanceof Node\UseItem || $parent instanceof Stmt\GroupUse;
}

function classConstTarget(?Node $node): ?string
{
    return $node instanceof Expr\ClassConstFetch && $node->class instanceof FullyQualified ? $node->class->toString() : null;
}

$appFiles = phpFiles($root.'/'.$sourceDir);
$asts = [];
$classToFile = [];
$nodes = [];

foreach ($appFiles as $absolute) {
    $path = substr($absolute, strlen($root) + 1);
    $source = file_get_contents($absolute);

    try {
        $asts[$path] = parse($absolute);
    } catch (PhpParser\Error $e) {
        fwrite(STDERR, "skip {$path}: {$e->getMessage()}\n");
        $asts[$path] = [];
    }

    $classes = $finder->findInstanceOf($asts[$path], Stmt\ClassLike::class);
    $primary = $classes[0] ?? null;
    foreach ($classes as $class) {
        if ($class->namespacedName !== null) {
            $classToFile[$class->namespacedName->toString()] = $path;
        }
    }

    $nodes[$path] = [
        'id' => $path,
        'fqcn' => $primary?->namespacedName?->toString(),
        'kind' => match (true) {
            $primary instanceof Stmt\Interface_ => 'interface',
            $primary instanceof Stmt\Trait_ => 'trait',
            $primary instanceof Stmt\Enum_ => 'enum',
            $primary instanceof Stmt\Class_ => $primary->isAbstract() ? 'abstract' : 'class',
            default => 'script',
        },
        'methods' => $primary === null ? 0 : count(array_filter($primary->getMethods(), fn (Stmt\ClassMethod $m) => $m->isPublic())),
        'lines' => substr_count($source, "\n") + 1,
    ];
}

$edges = [];
$addEdge = function (string $from, string $to, string $kind) use (&$edges): void {
    if ($from === $to) {
        return;
    }
    $key = $from."\0".$to;
    $edges[$key] ??= ['from' => $from, 'to' => $to, 'weight' => 0, 'kinds' => []];
    $edges[$key]['weight']++;
    $edges[$key]['kinds'][$kind] = ($edges[$key]['kinds'][$kind] ?? 0) + 1;
};

foreach ($asts as $path => $ast) {
    foreach ($finder->findInstanceOf($ast, FullyQualified::class) as $name) {
        $target = $classToFile[$name->toString()] ?? null;
        if ($target !== null && ! isImport($name)) {
            $addEdge($path, $target, referenceKind($name));
        }
    }

    foreach ($finder->findInstanceOf($ast, Stmt\Property::class) as $property) {
        if ($property->props[0]->name->toString() !== 'listen' || ! $property->props[0]->default instanceof Expr\Array_) {
            continue;
        }
        foreach ($property->props[0]->default->items as $item) {
            $event = $classToFile[classConstTarget($item?->key) ?? ''] ?? null;
            if ($event === null || ! $item->value instanceof Expr\Array_) {
                continue;
            }
            foreach ($item->value->items as $listenerItem) {
                $listener = $classToFile[classConstTarget($listenerItem?->value) ?? ''] ?? null;
                if ($listener !== null) {
                    $addEdge($event, $listener, 'triggers');
                }
            }
        }
    }

    foreach ($finder->findInstanceOf($ast, Expr\MethodCall::class) as $call) {
        if (! $call->name instanceof Node\Identifier || ! in_array($call->name->toLowerString(), ['bind', 'singleton', 'scoped'], true) || count($call->args) < 2) {
            continue;
        }
        $abstract = $classToFile[classConstTarget($call->args[0]->value ?? null) ?? ''] ?? null;
        $concrete = $classToFile[classConstTarget($call->args[1]->value ?? null) ?? ''] ?? null;
        if ($abstract !== null && $concrete !== null) {
            $addEdge($abstract, $concrete, 'binds');
        }
    }

    // Providers also declare bindings as `Interface::class => Implementation::class` maps looped into bind()
    if (($argv[4] ?? '') !== '' && str_starts_with($path, $providersPrefix)) {
        foreach ($finder->findInstanceOf($ast, Node\ArrayItem::class) as $item) {
            $abstract = $classToFile[classConstTarget($item->key) ?? ''] ?? null;
            $concrete = $classToFile[classConstTarget($item->value) ?? ''] ?? null;
            if ($abstract !== null && $concrete !== null) {
                $addEdge($abstract, $concrete, 'binds');
            }
        }
    }
}

$routeRefs = [];
foreach ($routesDir !== '' && is_dir($root.'/'.$routesDir) ? phpFiles($root.'/'.$routesDir) : [] as $absolute) {
    $routeFile = substr($absolute, strlen($root) + 1);
    foreach ($finder->findInstanceOf(parse($absolute), FullyQualified::class) as $name) {
        $target = $classToFile[$name->toString()] ?? null;
        if ($target !== null && ! isImport($name)) {
            $routeRefs[$target][$routeFile] = ($routeRefs[$target][$routeFile] ?? 0) + 1;
        }
    }
}

file_put_contents($output, json_encode([
    'nodes' => array_values($nodes),
    'edges' => array_values($edges),
    'routeRefs' => $routeRefs,
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

fwrite(STDERR, sprintf("deps: %d files, %d edges, %d route-referenced classes\n", count($nodes), count($edges), count($routeRefs)));
