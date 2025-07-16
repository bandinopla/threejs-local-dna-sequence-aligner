import { CameraControls } from "@react-three/drei";
import { useEffect, useState } from "react";
import { BufferAttribute, BufferGeometry, Clock, Color, Object3D, Points, ShaderMaterial, Vector3 } from "three";
import { Aligner, Result, type AlignmentStats } from "./Aligner";
import { useFrame } from "@react-three/fiber";
import { button, folder, useControls } from 'leva'
import { lerp } from "three/src/math/MathUtils.js";

enum DisplayShape {
    Spring ,
    Circle
} 

const dnaColorMap: Record<string, number> = {
  A: 0xff5555, // red
  T: 0x55ff55, // green
  C: 0x5555ff, // blue
  G: 0xffff55, // yellow
  R: 0xffaa00, // A or G (purine) - orange
  Y: 0xaa00ff, // C or T (pyrimidine) - purple
  K: 0x00aaff, // G or T - cyan
  M: 0xff00aa, // A or C - pink
  S: 0x00ffaa, // G or C - turquoise
  W: 0xaaff00, // A or T - lime
  B: 0xaaaaaa, // C or G or T - gray
  D: 0xbb8844, // A or G or T - brown
  H: 0xcc66cc, // A or C or T - lavender
  V: 0x66cc99, // A or C or G - teal
  N: 0x888888, // any base - dark gray
};

const letterToColor = (letter: string) => dnaColorMap[letter] ?? 0; 

/**
 * The material of each point
 */
const material = new ShaderMaterial({
    uniforms: {
        time: { value: 0 },
        pixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: `
        attribute float size;
        varying vec3 vColor;
        uniform float time;
        uniform float pixelRatio;
        
        void main() {
            vColor = color;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size * pixelRatio * (300.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        varying vec3 vColor;
        uniform float time;
        
        void main() {
            vec2 uv = gl_PointCoord.xy - 0.5;
            float dist = length(uv);
            if (dist > 0.5) discard;
            float alpha = 1.0;//1.0 - smoothstep(0.4, 0.5, dist);
            float glow = exp(-dist * 3.0) * 0.5 + 0.5;
            vec3 finalColor = vColor  * glow;
            gl_FragColor = vec4(finalColor, alpha);
        }
    `,
    transparent: true, 
    
    //depthWrite: false,
    //blending: AdditiveBlending,
    vertexColors: true, 
});

/**
 * Positions a point in the Spring arrangement.
 */
function addSpringPosition(positions: Float32Array, i: number, numParticles: number, ang:number, spins: number, ratio: number ) {
    //const a = (i / numParticles) * (Math.PI * 1.9) + 1

    const a = ang;

    const x = Math.cos(a)
    const y = Math.sin(a);

    const cross = new Vector3(x, y, 0).normalize();

    const p = new Vector3(x, y, 0);

    p.add(cross.multiplyScalar(Math.sin(a * spins) * .2 * ratio))

    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z + Math.cos(a * spins) * .2 * ratio;
}

/**
 * Positions a point in the flat circle arrangement.
 */
function addCirclePosition(positions: Float32Array, i: number, numParticles: number, ang:number, ratio: number, positionMatches:boolean) {
    const a = ang; // (i / numParticles) * (Math.PI * 1.9) + 1


    if (ratio < 1) ratio = 1 - .1 * ratio;

    const x = Math.cos(a) * ratio;
    const y = Math.sin(a) * ratio;


    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = positionMatches?.03:0;
}

/**
 * Represents a DNA Subject being aligned. The matches and mismatches will be shown with a green and red color, the rest will have a low saturation/brightness.
 */
class Strand extends Points {
    private sizes: Float32Array;
    private springShape: Float32Array;
    private circleShape: Float32Array;
    private myShape: Float32Array;
    private targetShape: Float32Array;
    private currentShape:DisplayShape; 
    private lerpFactor = 0;
    private pointSize = 0;

    constructor(readonly aligner: Aligner, imA:boolean, ratio: number = 1) {

        const NoMatchColor = 0xd62828;
        const MatchColor = 0x06d6a0;
        
        const longest = aligner.maxSequenceLength;

        /**
         * We use the longest sequence as the "norm" to distribute the 360 degrees display to create a step unit, to use anytime we have to advance one step.
         */
        const imTheLongest = imA ? aligner.sequence1.sequence.length == longest : aligner.sequence2.sequence.length == longest;
        const mySequence = imA ? aligner.sequence1.sequence : aligner.sequence2.sequence;

        const head = aligner.alignment[0];
        const tail = aligner.alignment.at(-1)!;

        const matchStartAt = (imA ? head.iA : head.iB) - 1;
        const matchEndsAt = (imA ? tail.iA : tail.iB) + 1; //+1 so we ignore gaps  

        /**
         * Gaps are places in the DNA where there was no match and the algorithm decided to skip the residue and try with the next one.
         * It basically considers that mismatch as a mutation and moves on...
         */
        const gaps = aligner.alignment.reduce((total, permutation) => {
            const gap = permutation.res == Result.A_NOMATCH || permutation.res == Result.B_NOMATCH;
            return total + (gap ? 1 : 0);
        }, 0);
 

        // [ 0,1,2,[3,4,5],6,7,8 ]

        /**
         * Arbitrary quantity used to calculate a total onto which distribute the 360 degrees.
         */
        const numParticles = longest + gaps;

        /**
         * This is a "normalized" step size, common to all Strand using this aligner. So the visualization overlaps correctly.
         * "*.9" so there's a gap to visually see the head and tail of a stang.
         */
        const stepAng = ((Math.PI*2)*.9) / numParticles ;

        /**
         * A strand has a segment in which the alignment occured. So it is made out of 3 parts... the start, the alignment, and the end...
         */
        const myParticlesCount =  ( imA? head.iA : head.iB ) 
                                + aligner.alignment.length // may include gaps (repetitions)... that's why we do this...
                                + ( mySequence.length-( imA? tail.iA : tail.iB ) );  
        

        //
        // calculating how many units of offset we start with...
        // so we calculate our sequence start index in relation to the longest sequence.
        //
        let ang = stepAng * ( imTheLongest? 0 : 
                            ( imA? head.iB - head.iA : // the index at the longest - our index
                                   head.iA - head.iB ) 
                                ); 

        const particleSize = .06;
        const spins = 112;

        console.log("TOTAL PARTICLES", myParticlesCount)

        const geometry = new BufferGeometry();
        const positions = new Float32Array(myParticlesCount * 3);
        const colors = new Float32Array(myParticlesCount * 3);
        const sizes = new Float32Array(myParticlesCount);

        const springShape = new Float32Array(myParticlesCount * 3);
        const circleShape = new Float32Array(myParticlesCount * 3);
 
        const color = new Color() ;

        let alignmentIndex = -1;
        let sequenceIndex = 0;

        for (let i = 0; i < myParticlesCount; i++) {

            let resiudeMatches = false;

            const letterColor = mySequence[sequenceIndex];
            let residueColor = letterToColor(letterColor);
            let colorMult = -.3;
            let brightness = .60;

            const inAlignmentRange = sequenceIndex > matchStartAt && sequenceIndex < matchEndsAt;

            sequenceIndex++;

            if (inAlignmentRange) {
                colorMult = 4;
                alignmentIndex++;
                brightness = 1.2;

                //only increment sequence index if we weren't skiped
                const permutation = aligner.alignment[alignmentIndex];

                if (permutation) {
                    sequenceIndex = imA ? permutation.iA : permutation.iB;

                    switch (permutation.res) {
                        case Result.NO_MATCH:
                            residueColor = NoMatchColor;
                            break;
                        case Result.A_NOMATCH: //gap, 
                            residueColor = imA ? NoMatchColor : 0; // black is like a gap... 
                            break;
                        case Result.B_NOMATCH:
                            residueColor = imA ? 0 : NoMatchColor;
                            break;
                        default:
                            residueColor = MatchColor;
                            resiudeMatches = true;
                    }
 
                }
            }


            color.set(residueColor);
            color.offsetHSL(0, colorMult, -(1 - brightness))

            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
            sizes[i] = particleSize * (0.6 + Math.random() * 0.5);

            addSpringPosition(springShape, i, myParticlesCount, ang, spins, ratio );
            addCirclePosition(circleShape, i, myParticlesCount, ang, ratio, resiudeMatches);

            positions[i * 3] = springShape[i * 3]
            positions[i * 3 + 1] = springShape[i * 3 + 1]
            positions[i * 3 + 2] = springShape[i * 3 + 2]

            ang += stepAng;
        }

        geometry.setAttribute('position', new BufferAttribute(positions, 3));
        geometry.setAttribute('color', new BufferAttribute(colors, 3));
        geometry.setAttribute('size', new BufferAttribute(sizes, 1));

        geometry.computeBoundingSphere();

        super(geometry, material);

        this.sizes = sizes;

        this.myShape = positions;
        this.targetShape = springShape;
        this.springShape = springShape;
        this.circleShape = circleShape;
        this.currentShape = DisplayShape.Spring;
        this.pointSize = particleSize;
    }

    update(delta: number) { 
 
        if( this.lerpFactor<=0 ) return;

        const myShape = this.myShape//this.geometry.attributes.position.array

        for (let i = 0; i < this.myShape.length; i+=3 ) { 

            myShape[i] = lerp( this.myShape[i], this.targetShape[i], 1-this.lerpFactor );
            myShape[i+1] = lerp( this.myShape[i+1], this.targetShape[i+1],  1-this.lerpFactor );
            myShape[i+2] = lerp( this.myShape[i+2], this.targetShape[i+2], 1-this.lerpFactor );
            
        }

        this.lerpFactor-= delta; 
        this.geometry.attributes.position.needsUpdate = true

        console.log( this.lerpFactor )
    }

    displayAs( shape:DisplayShape )
    {  
        console.log( shape, this.currentShape)
        if( this.currentShape==shape ) return;
        this.currentShape = shape;
        this.lerpFactor = 1;

        switch( shape )
        {
            case DisplayShape.Circle:
                this.targetShape = this.circleShape;
                break;
            case DisplayShape.Spring:
                this.targetShape = this.springShape;
                break;
        }

        console.log("GOGO", this.lerpFactor)
    }

    setPointSize( newSize:number )
    { 
        for (let i = 0; i < this.sizes.length; i++) { 
            this.sizes[i] = ( this.pointSize*newSize ) * (0.6 + Math.random() * 0.5);
        }
        this.geometry.attributes.size.needsUpdate = true
    }

    dispose() {
        this.geometry.dispose() 
    }
}

/**
 * An object containing the 2 Subjects being aligned
 */
class Alignment extends Object3D {
    readonly aligner: Aligner;
    private strand1: Strand;
    private strand2: Strand;
    private clock: Clock;

    readonly stats:AlignmentStats;

    constructor(dataSequence1: string, dataSequence2: string) {
        super();

        this.aligner = new Aligner(dataSequence1, dataSequence2)
        this.stats = this.aligner.stats;

        this.strand1 = new Strand(this.aligner, true, 1);
        this.add(this.strand1)

        this.strand2 = new Strand(this.aligner, false, .7);
   
        this.add(this.strand2)

        this.clock = new Clock()

    }

    update() {
        const delta = this.clock.getDelta();
        this.strand1.update(delta);
        this.strand2.update(delta);
    }

    displayAs( shape:DisplayShape )
    {
        console.log("!!!")
        this.strand1.displayAs(shape);
        this.strand2.displayAs(shape);
    }  

    setPointSize( newSize:number )
    {
        this.strand1.setPointSize(newSize)
        this.strand2.setPointSize(newSize)
    }

    dispose() {
        this.strand1.dispose();
        this.strand2.dispose();
    }
}



type DNAAlignmentProps = {
    onStats?:(stats:AlignmentStats)=>void
    fasta1:string 
    fasta2:string
}

export function DNAAlignmentVisualizer2({ fasta1, fasta2, onStats }:DNAAlignmentProps) {

    const [mc, setMc] = useState<Alignment>();
    const { pointSize } = useControls( {
 
        pointSize:{
            value: 2,
            min: .1,
            max: 5,
            step: .1,
        },
        
        "show as": folder({
            spring: button(() => mc?.displayAs(DisplayShape.Spring)),
            circle: button(() => mc?.displayAs(DisplayShape.Circle)), 
        }) 
     
    }, [mc])

    useEffect(() => {   
 
        const alignment = new Alignment(fasta1, fasta2)

        alignment.scale.multiplyScalar(2)
        setMc(alignment);
        onStats?.( alignment.stats );

        alignment.position.x = Math.random()

        return () => { 
            alignment.dispose()
        }

    }, [fasta1, fasta2]);

    useEffect(()=>{

        mc?.setPointSize(pointSize);

    },[ mc, pointSize])

    useFrame(() => mc?.update())

    return <>
        {mc && <primitive object={mc} />}
        <CameraControls />
    </>
}